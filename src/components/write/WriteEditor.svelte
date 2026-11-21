<script lang="ts">
/**
 * /write 写作中心：token 登录 → 文章列表（匿名只读）→ 左编辑右预览。
 * 「暂存草稿」写 write-drafts 分支（[CI Skip]，零构建、线上零影响），「发布」
 * 才提交 master 触发 Cloudflare Pages 构建。插图随文保存：插入/粘贴只存浏览器
 * 内存（预览用 blob URL 即时显示），暂存/发布时才随文上传到对应分支；正文里
 * 手改路径 = 重命名、删掉引用行 = 删图，保存时统一裁决（utils/write/images）。
 * 全部状态在客户端，无后端。
 */
import { onDestroy, onMount, tick, untrack } from "svelte";
import { SvelteMap } from "svelte/reactivity";
import { registerDirtyGuard } from "@/utils/dirty-guard";
import {
	clearVerified,
	markVerified,
	readVerifiedLogin,
	resolveToken,
} from "@/utils/write/auth";
import {
	type CmEditorHandle,
	createMarkdownEditor,
	type EditorLayout,
	readLayoutPref,
	readVimPref,
	writeLayoutPref,
	writeVimPref,
} from "@/utils/write/cm-editor";
import {
	DRAFT_BRANCH,
	deleteDraftFile,
	draftFileText,
	ensureDraftsBranch,
	fetchDraftFile,
	invalidateDraftCountCache,
	listDraftTree,
	prepareImageSaves,
	probeDraftAgainstMaster,
	publishPostFile,
	removeArticleDraftImages,
	saveDraftPost,
	sweepDraftImages,
	uploadPendingImages,
} from "@/utils/write/drafts";
import {
	getLuaStatus,
	type LuaStatus,
	onLuaLayout,
	registerEditorCommand,
	reloadLuaConfig,
	subscribeLuaStatus,
} from "@/utils/write/editor-config";
import {
	emptyFrontmatter,
	type PostFrontmatter,
	parsePostFile,
	RESERVED_CATEGORY,
	serializePostFile,
} from "@/utils/write/frontmatter";
import {
	deleteFile,
	describeGitHubError,
	fetchCurrentUser,
	fetchFile,
	GitHubError,
	listPostFiles,
	POSTS_DIR,
	WRITE_REPO,
} from "@/utils/write/github";
import {
	base64ToObjectUrl,
	buildImageMarkdown,
	defaultImageName,
	type ImagePlan,
	imageExtFrom,
	imageFilesFromClipboard,
	imagePublicDirFor,
	imageUrlToRepoPath,
	mimeFromName,
	type PendingImage,
	postImageRefs,
	reconcileRefs,
	safeDecode,
	sanitizeImageName,
	urlFileNameBase,
} from "@/utils/write/images";
import type { renderPreview } from "@/utils/write/preview";
import { createScrollSync } from "@/utils/write/scroll-sync";
import { persistToken } from "@/utils/write/session";
import {
	fileNameToSlug,
	timestampPrefix,
	todayDateString,
} from "@/utils/write/slug";
import ConfigDialog from "./ConfigDialog.svelte";
import DateField from "./DateField.svelte";
import ImageNameDialog from "./ImageNameDialog.svelte";

type View = "login" | "list" | "editor";

interface ListItem {
	name: string;
	path: string;
	sha: string;
	title: string;
	draft: boolean;
	published: string;
}

/** 新建文章时预填的示例正文（截图验收亦以此为准） */
const SAMPLE_BODY = `# 欢迎使用写作中心

这是一段示例**中文正文**，包含[一个链接](https://example.com)与行内代码 \`const hello = "world"\`。左侧编辑、右侧预览，保存后提交到 GitHub 仓库，Cloudflare 构建约 1-2 分钟后自动上线。

## 排版示例

- 列表项：支持 GFM 扩展语法
- 列表项：删除线 ~~旧文案~~、重点**加粗**、*斜体*
- 列表项：行内 \`代码片段\`

### 三级标题

1. 有序列表一
2. 有序列表二

<!-- 插图：点「插入图片」选图命名，或 Ctrl+V 直接粘贴；图片随暂存/发布自动上传 -->

\`\`\`ts
// 围栏代码块示例（构建后由 expressive-code 高亮，预览为普通样式）
export function greet(name: string): string {
	return \`你好，\${name}\`;
}
\`\`\`

> 引用：替换为正文内容，保存后约 1-2 分钟自动上线。
`;

const inputClass =
	"w-full px-3 py-2 text-sm bg-transparent border border-black/10 dark:border-white/10 rounded-lg focus:ring-2 focus:ring-(--primary) focus:border-(--primary) hover:border-black/20 dark:hover:border-white/20 text-75 write-input transition-colors outline-hidden";

const labelClass = "block text-xs font-medium text-50 mb-1";

/** 保留分类名之二（批37）：分类条入口由「未发布」改名「草稿」，真分类不得占用；
 * 与 frontmatter.ts 的 RESERVED_CATEGORY 并列校验（该文件不在本批写集） */
const RESERVED_CATEGORY_DRAFT = "草稿";

// --- 全局状态 ---
let view = $state<View>("login");
let token = $state("");
let userLogin = $state<string | null>(null);
let authChecking = $state(true);
let notice = $state("");
let noticeTimer: ReturnType<typeof setTimeout> | undefined;

// --- 登录 ---
let tokenInput = $state("");
let loginBusy = $state(false);
let loginError = $state("");

// --- 列表 ---
let listItems = $state<ListItem[]>([]);
let listLoading = $state(false);
let listLoaded = $state(false);
let listError = $state("");
let listTotal = $state(0);
let listDone = $state(0);

// --- 编辑器 ---
let fm = $state<PostFrontmatter>(emptyFrontmatter());
let body = $state("");
let extras = $state<Record<string, unknown>>({});
let fileName = $state("");
let fileNameTouched = $state(false);
let fileExt = $state<"md" | "mdx">("md");
let loadedPath = $state<string | null>(null); // 当前 sha 对应的远端路径
let sha = $state<string | null>(null);
let tagsInput = $state("");
// type="number" 的 bind:value 会给 number/null（见 syncMetaInputs 注释），声明放宽
let seriesOrderInput = $state<string | number | null>("");
let showFrontmatter = $state(true);
let mobileTab = $state<"edit" | "preview">("edit");
// P3：桌面三态布局（仅编辑/双窗/仅预览），偏好存 ff.editor.layout；<md 仍是 tab 切换
let layout = $state<EditorLayout>(readLayoutPref());
// P7：vim 模式开关（默认关），偏好存 ff.editor.vim
let vimOn = $state(readVimPref());
let editorLoading = $state(false);
const editorReady = $derived(view === "editor" && !editorLoading);
let previewRenderer = $state<typeof renderPreview | null>(null);
let previewLoadError = $state("");
let editorError = $state("");
let conflictPending = $state(false);
let saving = $state(false);
let deleting = $state(false);
/** CM6 宿主与句柄：句柄不进 $state（EditorView 内部状态多，代理化无意义） */
let cmHost = $state<HTMLDivElement | null>(null);
let cmReady = $state(false);
let cmHandle: CmEditorHandle | null = null;
/** P2：预览卡内部滚动容器（scroll-sync 对端） */
let previewCard = $state<HTMLDivElement | null>(null);
let imageInput = $state<HTMLInputElement | null>(null);
// 批31：lua 配置弹层与状态徽标（错误时顶栏亮红点；配置热应用走 reloadLuaConfig）
let configOpen = $state(false);
let luaStatus = $state<LuaStatus>(getLuaStatus());

/** 三态按钮轨（P3，用户图二：预览卡右外沿竖排） */
const layoutButtons: { value: EditorLayout; label: string }[] = [
	{ value: "edit", label: "仅编辑" },
	{ value: "split", label: "双窗" },
	{ value: "preview", label: "仅预览" },
];

// --- 插图随文保存（裁决纯逻辑见 utils/write/images） ---
/**
 * 待上传图（公开 URL → 字节 + 本地预览 blob）：插入/粘贴只进内存，
 * 暂存时传草稿分支、发布时传 master；刷新即丢，与未保存文字同级语义。
 * 切换文章时旧键自然失配，applyImagePlan 按删图回收，不会误删远端文件。
 */
let pendingImages = new SvelteMap<string, PendingImage>();
/** 命名卡当前处理的图片（选完文件弹出，确认后进 pendingImages） */
let nameDialog = $state<{
	base64: string;
	objectUrl: string;
	suggested: string;
	ext: string;
} | null>(null);
/** 插图上传进度（暂存/发布按钮文案用） */
let imageUploadDone = $state(0);
let imageUploadTotal = $state(0);
/** 草稿分支图预览缓存（URL → blob URL）：master 没有的图从草稿分支拉一次展示 */
let draftPreviewUrls = new SvelteMap<string, string>();
// 非响应式会话缓存：草稿预取去重、本会话已上传过的目标分支 URL（重复保存免重传）
const draftPreviewTried = new Set<string>();
const draftPreviewInFlight = new Set<string>();
const draftUploadedUrls = new Set<string>();
const masterUploadedUrls = new Set<string>();
/** 裁决产生的旧地址 → blob 备查：正文引用要到保存时才改写，期间预览靠它不断链 */
const retiredPreviewUrls = new Map<string, string>();

// --- 暂存草稿（write-drafts 分支，批37 文案统一）---
let draftSha = $state<string | null>(null); // 草稿分支文件版本号（暂存更新 / 丢弃清理用）
let savingDraft = $state(false);
let loadingDraft = $state(false);
let discardingDraft = $state(false);
let draftBanner = $state<string | null>(null); // 非空 = 有未发布草稿，值为保存时间文案
/**
 * 草稿分支目录索引（path → 文件名），登录态下拉；含已在 master 的路径（列表徽标用）。
 * 用 SvelteMap：暂存/丢弃走 .set()/.delete() 原地变更，$state 的普通 Map 不代理
 * Map 变更（实测探针 26：请求发出但界面不刷新），SvelteMap 才触发响应。
 */
let draftIndex = new SvelteMap<string, string>();
/** 草稿分组的展示标题（path → frontmatter 标题）：目录接口不含标题，逐个后台拉取；
 *  无标题 / 解析失败回退文件名。同上用 SvelteMap（loadDraftTitles 靠 .set() 刷新行） */
let draftTitles = new SvelteMap<string, string>();
/** 最近一次持久化（master 或草稿分支）的全文快照，驱动 beforeunload 拦截 */
let storedSnapshot = $state("");
/** 草稿索引是否加载完（成败都算）：?drafts=1 草稿页空判定「确定没有草稿」的早退依据 */
let draftIndexLoaded = $state(false);
/** ?drafts=1 = 草稿页稳定模式（批37）：期间列表区呈「已发布/未发布」两块布局，参数不再用完即清 */
let draftsMode = $state(false);

const isLoggedIn = $derived(userLogin !== null && token !== "");
const currentPath = $derived(
	fileName.trim() ? `${POSTS_DIR}/${fileName.trim()}.${fileExt}` : "",
);
const filenameChanged = $derived(
	loadedPath !== null && currentPath !== "" && currentPath !== loadedPath,
);
/**
 * 嵌套路径文章（如 nvim/1_start.md，批36）：文件名锁只读（跨目录改名超出本轮），
 * 保存路径忠实于远端，插图目录随路径推导（articleSlugDir 保留嵌套层级）。
 */
const nestedPost = $derived(
	loadedPath !== null &&
		loadedPath.startsWith(`${POSTS_DIR}/`) &&
		loadedPath.slice(POSTS_DIR.length + 1).includes("/"),
);
const dirty = $derived(
	view === "editor" &&
		!editorLoading &&
		serializePostFile(fm, extras, body) !== storedSnapshot,
);
const draftOnlyItems = $derived(
	[...draftIndex.entries()]
		.filter(([path]) => !listItems.some((item) => item.path === path))
		.map(([path, name]) => ({ path, name }))
		.sort((a, b) => b.name.localeCompare(a.name)),
);
/** master 上 draft: true 的文章（「未发布」分组第一节，点开走 openPost，批36） */
const masterDraftItems = $derived(listItems.filter((item) => item.draft));
/** 已发布且有暂存草稿的文章（草稿页「已发布」块）：发布/丢弃后副本自动消失，
 * 属瞬态不计入胶囊（§16.3-D 口径 v2 不动） */
const publishedWithDraftItems = $derived(
	listItems.filter((item) => !item.draft && draftIndex.has(item.path)),
);

$effect(() => {
	if (!editorReady) return;
	if (untrack(() => previewRenderer)) return;
	let disposed = false;
	previewLoadError = "";
	void import("@/utils/write/preview")
		.then(({ renderPreview }) => {
			if (!disposed) previewRenderer = renderPreview;
		})
		.catch((error: unknown) => {
			if (!disposed) {
				previewLoadError =
					error instanceof Error ? error.message : String(error);
			}
		});
	return () => {
		disposed = true;
	};
});

const preview = $derived.by(() => {
	if (!editorReady) return { html: "", error: "" };
	const render = previewRenderer;
	if (!render) return { html: "", error: previewLoadError };
	try {
		return { html: render(body, resolvePreviewImage), error: "" };
	} catch (error) {
		return {
			html: "",
			error: error instanceof Error ? error.message : String(error),
		};
	}
});

// --- 插图实时裁决：手改路径 = 重命名、删引用行 = 删图（保存时同一套规则） ---

const imagePlan = $derived(
	reconcileRefs(
		postImageRefs(body),
		pendingImages,
		// 与 stageImage 的 articleDirUrl() 同源兜底：文件名未定时同走 untitled，
		// 否则空名派生目录与待上传键错位 → 配对误判自改名 → 响应死循环
		imagePublicDirFor(`${fileName.trim() || "untitled"}.${fileExt}`),
	),
);

/** 待上传表与正文引用同步（重键/清理）；保存流程改写正文后也调用这一份 */
function applyImagePlan(plan: ImagePlan) {
	for (const url of plan.droppedUrls) {
		const entry = pendingImages.get(url);
		if (entry) {
			pendingImages.delete(url);
			// 同一 blob 可能仍被 retired 备查键引用，先确认没人用再回收
			if (![...retiredPreviewUrls.values()].includes(entry.objectUrl)) {
				URL.revokeObjectURL(entry.objectUrl);
			}
		}
	}
	for (const rename of plan.renames) {
		// 防御：from===to 的自改名对 SvelteMap delete+set 每次都发信号，
		// 会让派生 plan 无限重算（实测 effect_update_depth_exceeded 冻死整组件）
		if (rename.fromUrl === rename.toUrl) continue;
		const entry = pendingImages.get(rename.fromUrl);
		if (!entry) continue;
		retiredPreviewUrls.set(rename.fromUrl, entry.objectUrl);
		pendingImages.delete(rename.fromUrl);
		pendingImages.set(rename.toUrl, entry);
	}
	// 已上传图的改名落库（保存时仓库文件已同步改名）：已上传 URL 集与草稿
	// 预览缓存按旧键 → 新键搬家，改完名的引用继续命中缓存，不必重新回源
	for (const rename of plan.renames) {
		if (rename.fromUrl === rename.toUrl) continue;
		if (
			pendingImages.has(rename.fromUrl) ||
			!(
				draftUploadedUrls.has(rename.fromUrl) ||
				masterUploadedUrls.has(rename.fromUrl) ||
				draftPreviewUrls.has(rename.fromUrl)
			)
		) {
			continue;
		}
		if (draftUploadedUrls.has(rename.fromUrl)) {
			draftUploadedUrls.delete(rename.fromUrl);
			draftUploadedUrls.add(rename.toUrl);
		}
		if (masterUploadedUrls.has(rename.fromUrl)) {
			masterUploadedUrls.delete(rename.fromUrl);
			masterUploadedUrls.add(rename.toUrl);
		}
		const cached = draftPreviewUrls.get(rename.fromUrl);
		if (cached) {
			draftPreviewUrls.delete(rename.fromUrl);
			draftPreviewUrls.set(rename.toUrl, cached);
		}
		// 新键不再走草稿分支预取（旧键已试过的记录搬到新键，省一次回源与 blob 泄漏）
		if (draftPreviewTried.has(rename.fromUrl)) {
			draftPreviewTried.delete(rename.fromUrl);
			draftPreviewTried.add(rename.toUrl);
		}
	}
	// 目录写法差异的命中上传（untitled/旧平铺引用）：正文要到保存才改写，
	// 期间旧写法 URL 也指向同一 blob，备查防预览断链
	for (const upload of plan.uploads) {
		const entry = pendingImages.get(upload.url);
		if (
			entry &&
			upload.refUrl !== upload.url &&
			!pendingImages.has(upload.refUrl)
		) {
			retiredPreviewUrls.set(upload.refUrl, entry.objectUrl);
		}
	}
}

// 派生 plan 与清理互相收敛（重键后精确命中、删图后无引用），不会循环
$effect(() => {
	applyImagePlan(imagePlan);
});

/** 预览 img src 解析：待上传 blob → 重命名前旧地址 → 草稿分支缓存 blob → 原样 */
function resolvePreviewImage(url: string): string | null {
	return (
		pendingImages.get(url)?.objectUrl ??
		retiredPreviewUrls.get(url) ??
		draftPreviewUrls.get(url) ??
		null
	);
}

// 草稿分支图预取：非待上传的站内图若 master 没有（预览会裂图），从草稿分支拉
// 一次转 blob 展示。每 URL 每会话只试一次，失败静默（已发布图原 URL 天然可用）。
$effect(() => {
	if (view !== "editor" || editorLoading || !token) return;
	for (const ref of postImageRefs(body)) {
		const url = safeDecode(ref.url);
		if (
			pendingImages.has(url) ||
			draftPreviewUrls.has(url) ||
			draftPreviewTried.has(url) ||
			draftPreviewInFlight.has(url)
		) {
			continue;
		}
		const repoPath = imageUrlToRepoPath(url);
		if (!repoPath) continue;
		draftPreviewInFlight.add(url);
		void fetchDraftFile(token, repoPath)
			.then((file) => {
				if (file) {
					draftPreviewUrls.set(
						url,
						base64ToObjectUrl(file.base64, mimeFromName(repoPath)),
					);
				}
			})
			.catch(() => {
				/* 静默：预览回退原 URL */
			})
			.finally(() => {
				draftPreviewInFlight.delete(url);
				draftPreviewTried.add(url);
			});
	}
});

// 组件销毁（swup 换页）：回收本地预览 blob（图片本体随刷新丢弃，与未保存文字同级）
onDestroy(() => {
	for (const entry of pendingImages.values()) {
		URL.revokeObjectURL(entry.objectUrl);
	}
	for (const objectUrl of retiredPreviewUrls.values()) {
		URL.revokeObjectURL(objectUrl);
	}
});

function showToast(text: string) {
	notice = text;
	if (noticeTimer !== undefined) clearTimeout(noticeTimer);
	noticeTimer = setTimeout(() => {
		notice = "";
	}, 4000);
}

/** toast 传送到 body（批36）：页面内容容器带 onload transform，position:fixed
 * 会被它劫持成相对容器定位——编辑器页比视口高时 toast 落在折叠线以下看不见
 * （实测 rect.y=1673 / 视口 900）。挂到 body 才是真视口固定。 */
function portalToBody(node: HTMLElement) {
	document.body.appendChild(node);
	return {
		destroy() {
			node.remove();
		},
	};
}

// 编辑中有未持久化的修改时，关页面前给浏览器原生提示（暂存/发布后解除）
$effect(() => {
	if (!dirty) return;
	const handler = (event: BeforeUnloadEvent) => {
		event.preventDefault();
	};
	window.addEventListener("beforeunload", handler);
	return () => window.removeEventListener("beforeunload", handler);
});

// 站内 swup 换页不走 beforeunload：编辑态把守卫登记进 swup visit:start 拦截
// （utils/dirty-guard + swup-transitions），脏了弹确认，不脏直接放行
$effect(() => {
	if (view !== "editor") return;
	return registerDirtyGuard(
		() => !dirty || window.confirm("有未保存的修改，确定离开吗？"),
	);
});

// --- CM6 装配（P5/P6/P7，依赖在客户端动态加载）---
// 宿主挂载后异步创建；editorLoading / 离开编辑视图会销毁宿主，实例随之销毁。
// 初始 body / vim 偏好走 untrack：它们的后续变化分别由同步 effect 与 setVim 处理，
// 不能触发本 effect 重建编辑器（重建会丢光标、丢撤销栈、丢滚动位置）。
$effect(() => {
	const host = cmHost;
	if (!host || editorLoading) return;
	let disposed = false;
	let handle: CmEditorHandle | null = null;
	void createMarkdownEditor(host, {
		value: untrack(() => body),
		placeholder: "在这里书写正文（Markdown），支持 Ctrl+V 直接粘贴图片……",
		onDocChange: (value) => {
			body = value;
		},
		vimEnabled: untrack(() => vimOn),
	}).then((created) => {
		if (disposed) {
			created.destroy();
			return;
		}
		handle = created;
		cmHandle = created;
		cmReady = true;
		if (!disposed && isLoggedIn) {
			// 批31 lua 配置初始化：先注册 save 命令（lua ff.map 右值引用）再拉配置执行；
			// 失败兜底在 reloadLuaConfig 内部（错误徽标 + 编辑器照常可用）
			registerEditorCommand("save", () => void saveDraft());
			void reloadLuaConfig(token, created);
		}
	});
	return () => {
		disposed = true;
		handle?.destroy();
		if (handle && cmHandle === handle) cmHandle = null;
		cmReady = false;
	};
});

// 批31：lua 配置状态徽标订阅（顶栏红点）；layout 热应用（ff.opt.layout 写偏好并切布局）
$effect(() => {
	if (view !== "editor") return;
	const unsub = subscribeLuaStatus((status) => {
		luaStatus = status;
	});
	const offLayout = onLuaLayout((next) => {
		layout = next;
	});
	return () => {
		unsub();
		offLayout();
	};
});

// 外部改写 body（载入文章 / 暂存发布流程改写插图路径）→ 反映进 CM；
// CM 自身 doc 变化回流 body 相等时 setValue 是 no-op，不会成环
$effect(() => {
	if (!cmReady) return;
	cmHandle?.setValue(body);
});

// P2→批37：双窗态行号锚点滚动同步（CM 视图 ↔ 预览卡）；非 split 布局自动停用。
// 批41：句柄不再随 body 逐键重建（过去 void body 强依赖导致每键 destroy+create）；
// 预览重渲/图片加载导致的锚点位置变化由 scroll-sync 内部的 Resize/Mutation 监听失效
$effect(() => {
	if (!cmReady) return;
	const edView = cmHandle?.view;
	const pv = previewCard;
	if (!edView || !pv) return;
	const sync = createScrollSync(edView, pv, {
		enabled: () => layout === "split",
	});
	return () => sync.destroy();
});

/** P3：切布局态并持久化（ff.editor.layout，刷新保持） */
function setLayout(next: EditorLayout) {
	layout = next;
	writeLayoutPref(next);
}

/** P7：vim 热开关（ff.editor.vim，默认关；Compartment 重配不重建编辑器） */
async function toggleVim() {
	vimOn = !vimOn;
	writeVimPref(vimOn);
	await cmHandle?.setVim(vimOn);
}

function storeToken(value: string) {
	token = value;
	persistToken(value);
}

/** 401 或手动登出：清 token、回登录卡 */
function forceLogout(message: string) {
	storeToken("");
	clearVerified();
	userLogin = null;
	loginError = message;
	view = "login";
}

onMount(() => {
	// 草稿页模式只看落地 URL：?drafts=1 期间页面保持两块布局（批37 参数即模式）
	draftsMode = wantsDraftFocus();
	// 复用自身或 /admin（Sveltia）登录态的 token；验证通过时顺带刷新入口门控缓存
	const saved = resolveToken();
	if (!saved) {
		authChecking = false;
		return;
	}
	token = saved;
	const cachedLogin = readVerifiedLogin(saved);
	if (cachedLogin) {
		userLogin = cachedLogin;
		authChecking = false;
		if (wantsNewPost()) {
			newPost();
			return;
		}
		view = "list";
		void loadList();
		void focusDraftGroup();
		return;
	}
	fetchCurrentUser(saved)
		.then((user) => {
			userLogin = user.login;
			markVerified(saved, user.login);
			if (wantsNewPost()) {
				newPost();
				return;
			}
			view = "list";
			void loadList();
			void focusDraftGroup();
		})
		.catch((error: unknown) => {
			if (
				error instanceof GitHubError &&
				(error.kind === "unauthorized" || error.kind === "forbidden")
			) {
				forceLogout("已保存的 token 已失效，请重新登录");
			} else {
				loginError = describeGitHubError(error);
				view = "login";
			}
		})
		.finally(() => {
			authChecking = false;
		});
});

// --- 登录 / 列表 ---

/** URL 带 ?new=1：登录后跳过列表直接进新文章（首页「写文章」入口的目标） */
function wantsNewPost() {
	return new URLSearchParams(window.location.search).has("new");
}

/** URL 带 ?drafts=1（分类条「草稿」入口，批37）：进入草稿页稳定模式 */
function wantsDraftFocus() {
	return new URLSearchParams(window.location.search).has("drafts");
}

/** 草稿分组容器 id（模板内未发布块同款） */
const DRAFT_GROUP_ID = "draft-group";

/**
 * 草稿页空判定（批37：?drafts=1 参数即模式，不再滚动聚焦/闪烁/清参数）：
 * 登录态等列表与草稿索引载入完成（最长 10s），三块全空（master 草稿 /
 * 暂存独有 / 已发布有副本）→ 一次性 toast「暂无草稿」；列表失败 →
 * 错误横幅自会提示，不打扰。
 */
async function focusDraftGroup() {
	if (!wantsDraftFocus() || !isLoggedIn) return;
	for (let waited = 0; waited < 10_000; waited += 200) {
		await tick();
		if (listError) return;
		if (listLoaded && draftIndexLoaded) {
			if (
				masterDraftItems.length === 0 &&
				draftOnlyItems.length === 0 &&
				publishedWithDraftItems.length === 0
			) {
				showToast("暂无草稿");
			}
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
}

async function handleLogin() {
	const value = tokenInput.trim();
	if (!value || loginBusy) return;
	loginBusy = true;
	loginError = "";
	try {
		const user = await fetchCurrentUser(value);
		storeToken(value);
		markVerified(value, user.login);
		userLogin = user.login;
		tokenInput = "";
		if (wantsNewPost()) {
			newPost();
			return;
		}
		view = "list";
		await loadList();
		void focusDraftGroup();
	} catch (error) {
		loginError = describeGitHubError(error);
	} finally {
		loginBusy = false;
	}
}

function handleLogout() {
	forceLogout("已退出登录");
}

function browseAnonymous() {
	loginError = "";
	view = "list";
	if (!listLoaded && !listLoading) void loadList();
}

async function loadList() {
	if (listLoading) return;
	listLoading = true;
	listError = "";
	listTotal = 0;
	listDone = 0;
	draftIndexLoaded = false;
	try {
		const files = await listPostFiles(token);
		listTotal = files.length;
		const items: ListItem[] = [];
		const queue = [...files];
		const worker = async () => {
			for (;;) {
				const file = queue.shift();
				if (!file) break;
				// name 承载 POSTS_DIR 相对路径（批36：嵌套文章如 nvim/1_start.md），
				// openPost 据此反推文件名即保真路径；顶层文件与旧口径同形
				const relPath = file.path.startsWith(`${POSTS_DIR}/`)
					? file.path.slice(POSTS_DIR.length + 1)
					: file.path;
				try {
					const { text } = await fetchFile(token, file.path);
					const parsed = parsePostFile(text);
					items.push({
						name: relPath,
						path: file.path,
						sha: file.sha,
						title: parsed.frontmatter.title || file.name,
						draft: parsed.frontmatter.draft,
						published: parsed.frontmatter.published,
					});
				} catch {
					// 单篇解析失败不阻塞列表：退化为只展示文件名
					items.push({
						name: relPath,
						path: file.path,
						sha: file.sha,
						title: relPath,
						draft: false,
						published: "",
					});
				}
				listDone += 1;
			}
		};
		await Promise.all([worker(), worker(), worker(), worker()]);
		items.sort((a, b) => b.name.localeCompare(a.name));
		listItems = items;
		listLoaded = true;
		void loadDraftIndex();
	} catch (error) {
		listError = describeGitHubError(error);
		// 401 到达时若正在编辑（保存后触发的后台刷新等），不踢回登录卡清掉编辑现场；
		// 下一次点保存会再次收到 401，那时再走 forceLogout
		if (
			error instanceof GitHubError &&
			error.kind === "unauthorized" &&
			view !== "editor"
		) {
			forceLogout("登录已失效，请重新登录");
		}
	} finally {
		listLoading = false;
	}
}

/** 拉草稿分支目录索引（仅登录态；失败静默，只影响徽标与「暂存草稿」分组） */
async function loadDraftIndex() {
	if (!isLoggedIn) {
		draftIndex.clear();
		draftTitles.clear();
		return;
	}
	try {
		const map = new Map<string, string>();
		// 批36：改递归清单（嵌套文章暂存草稿落子目录，顶层列举会漏）
		for (const entry of await listDraftTree(token, POSTS_DIR)) {
			if (!/\.(md|mdx)$/i.test(entry.name)) continue;
			const relPath = entry.path.startsWith(`${POSTS_DIR}/`)
				? entry.path.slice(POSTS_DIR.length + 1)
				: entry.path;
			map.set(entry.path, relPath);
		}
		draftIndex.clear();
		for (const [path, name] of map) draftIndex.set(path, name);
		void loadDraftTitles();
	} catch {
		/* 草稿索引失败不打扰主列表 */
	} finally {
		draftIndexLoaded = true;
	}
}

/** 逐个拉「仅存草稿」的 frontmatter 标题（草稿数量少，N 次小请求换直观列表；
 *  目录接口只有文件名，标题在文件内容里）。失败 / 无标题静默回退文件名。
 *  已有标题的路径跳过（暂存时由 saveDraft 直接写入，避免重复请求与闪烁）。 */
async function loadDraftTitles() {
	if (!isLoggedIn) return;
	const paths = [...draftIndex.keys()].filter(
		(path) => !listItems.some((item) => item.path === path),
	);
	for (const path of paths) {
		if (draftTitles.has(path)) continue;
		try {
			const file = await fetchDraftFile(token, path);
			if (!file) continue;
			const parsed = parsePostFile(draftFileText(file));
			const title = parsed.frontmatter.title.trim();
			if (title) draftTitles.set(path, title);
		} catch {
			/* 单篇失败回退文件名 */
		}
	}
}

/** 首页导航「写文章」弹窗经 sessionStorage 传来的新文章种子（预填 frontmatter） */
const NEW_SEED_KEY = "write-editor-new-seed";

interface NewPostSeed {
	title: string;
	published: string;
	category: string;
	tags: string[];
	description: string;
	slug: string;
	image: string;
	author: string;
	series: string;
	seriesOrder: number | null;
	pinned: boolean;
	draft: boolean;
}

function readNewPostSeed(): NewPostSeed | null {
	try {
		const raw = sessionStorage.getItem(NEW_SEED_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as NewPostSeed;
		if (!parsed || typeof parsed !== "object") return null;
		const published =
			typeof parsed.published === "string" ? parsed.published.trim() : "";
		const seriesOrder =
			typeof parsed.seriesOrder === "number" &&
			Number.isFinite(parsed.seriesOrder)
				? parsed.seriesOrder
				: null;
		return {
			title: typeof parsed.title === "string" ? parsed.title.trim() : "",
			// 非 YYYY-MM-DD 的日期不可信，交回编辑器兜底（同样是今天）
			published: /^\d{4}-\d{2}-\d{2}$/.test(published) ? published : "",
			category:
				typeof parsed.category === "string" ? parsed.category.trim() : "",
			tags: Array.isArray(parsed.tags)
				? parsed.tags
						.filter(
							(t): t is string => typeof t === "string" && t.trim() !== "",
						)
						.map((t) => t.trim())
				: [],
			description:
				typeof parsed.description === "string" ? parsed.description.trim() : "",
			slug: typeof parsed.slug === "string" ? parsed.slug.trim() : "",
			image: typeof parsed.image === "string" ? parsed.image.trim() : "",
			author: typeof parsed.author === "string" ? parsed.author.trim() : "",
			series: typeof parsed.series === "string" ? parsed.series.trim() : "",
			seriesOrder,
			pinned: parsed.pinned === true,
			draft: parsed.draft === true,
		};
	} catch {
		return null;
	}
}

function newPost() {
	if (!isLoggedIn) {
		view = "login";
		loginError = "请先登录后再新建文章";
		return;
	}
	fm = emptyFrontmatter(true);
	fm.published = todayDateString();
	// 弹窗种子：frontmatter 各字段预填进文章信息，正文置空（非示例正文）；
	// 有标题时立即联动生成文件名与 slug（onTitleBlur 对新建流程幂等）
	const seed = readNewPostSeed();
	if (seed) {
		try {
			sessionStorage.removeItem(NEW_SEED_KEY);
		} catch {
			/* 忽略 */
		}
		// 弹窗的草稿勾选是显式意图，覆盖「新建默认草稿」的安全默认（否则弹窗不勾草稿也会存成草稿）
		fm.draft = seed.draft;
	}
	if (seed?.title) fm.title = seed.title;
	if (seed?.published) fm.published = seed.published;
	if (seed?.category) fm.category = seed.category;
	if (seed?.description) fm.description = seed.description;
	if (seed?.tags?.length) fm.tags = seed.tags;
	if (seed?.slug) fm.slug = seed.slug;
	if (seed?.image) fm.image = seed.image;
	if (seed?.author) fm.author = seed.author;
	if (seed?.series) fm.series = seed.series;
	if (seed?.seriesOrder != null) {
		fm.seriesOrder = seed.seriesOrder;
	}
	if (seed?.pinned) fm.pinned = true;
	body = seed ? "" : SAMPLE_BODY;
	extras = {};
	fileName = "";
	fileNameTouched = false;
	fileExt = "md";
	loadedPath = null;
	sha = null;
	tagsInput = fm.tags.join(", ");
	seriesOrderInput = fm.seriesOrder == null ? "" : String(fm.seriesOrder);
	showFrontmatter = true;
	mobileTab = "edit";
	editorError = "";
	conflictPending = false;
	draftSha = null;
	draftBanner = null;
	// 先让标题联动落定（生成文件名/slug），再拍快照——顺序反了编辑器一打开就是脏态
	if (seed?.title) onTitleBlur();
	storedSnapshot = serializePostFile(fm, extras, body);
	view = "editor";
}

async function openPost(item: ListItem) {
	view = "editor";
	editorLoading = true;
	editorError = "";
	conflictPending = false;
	showFrontmatter = true;
	mobileTab = "edit";
	try {
		const file = await fetchFile(token, item.path);
		const parsed = parsePostFile(file.text);
		fm = parsed.frontmatter;
		body = parsed.body;
		extras = parsed.extras;
		fileName = item.name.replace(/\.(md|mdx)$/i, "");
		fileNameTouched = true; // 已有文章：标题失焦不再改写文件名
		fileExt = /\.mdx$/i.test(item.name) ? "mdx" : "md";
		loadedPath = item.path;
		sha = file.sha;
		tagsInput = fm.tags.join(", ");
		seriesOrderInput = fm.seriesOrder == null ? "" : String(fm.seriesOrder);
		draftSha = null;
		draftBanner = null;
		storedSnapshot = serializePostFile(fm, extras, body);
		// 草稿探测失败静默（probe 内部吞错），不阻塞主编辑流程
		if (isLoggedIn) void probeDraft(item.path, file.text);
	} catch (error) {
		editorError = describeGitHubError(error);
		if (error instanceof GitHubError && error.kind === "unauthorized") {
			forceLogout("登录已失效，请重新登录");
		}
	} finally {
		editorLoading = false;
	}
}

/** 打开已发布文章后的草稿探测：草稿分支有更新且不同的内容 → 横幅提示 */
async function probeDraft(path: string, masterText: string) {
	const probe = await probeDraftAgainstMaster(token, path, masterText);
	if (!probe) return;
	if (loadedPath !== path) return; // 探测期间已切到别的文章，丢弃过期结果
	draftSha = probe.sha;
	draftBanner = probe.banner || null;
}

/**
 * 打开仅存于草稿分支的文章（列表「暂存草稿」分组入口）：
 * master 上还没有这个文件，发布后才会成为正式文章。
 */
async function openDraftOnly(path: string) {
	view = "editor";
	editorLoading = true;
	editorError = "";
	conflictPending = false;
	showFrontmatter = true;
	mobileTab = "edit";
	try {
		const file = await fetchDraftFile(token, path);
		if (!file) {
			throw new GitHubError("not-found", 404, "草稿不存在（可能已被清理）");
		}
		const parsed = parsePostFile(draftFileText(file));
		fm = parsed.frontmatter;
		body = parsed.body;
		extras = parsed.extras;
		// fileName 承载相对路径（与 openPost 同口径）：嵌套草稿发布回写不漂移
		const relPath = path.startsWith(`${POSTS_DIR}/`)
			? path.slice(POSTS_DIR.length + 1)
			: path;
		fileName = relPath.replace(/\.(md|mdx)$/i, "");
		fileNameTouched = true;
		fileExt = /\.mdx$/i.test(relPath) ? "mdx" : "md";
		loadedPath = path;
		sha = null; // master 上还没有：发布即新建
		draftSha = file.sha;
		draftBanner = null;
		tagsInput = fm.tags.join(", ");
		seriesOrderInput = fm.seriesOrder == null ? "" : String(fm.seriesOrder);
		storedSnapshot = serializePostFile(fm, extras, body);
		showToast("已载入暂存草稿：点「发布」后才会成为正式文章");
	} catch (error) {
		editorError = describeGitHubError(error);
		view = "list";
		if (error instanceof GitHubError && error.kind === "unauthorized") {
			forceLogout("登录已失效，请重新登录");
		}
	} finally {
		editorLoading = false;
	}
}

// --- 编辑器 ---

/**
 * 新建文章：标题失焦且文件名未被手动改过 → 自动建议 YYYY-MM-DD-slug 文件名；
 * 后缀优先用弹窗种子带入的 slug，其次按标题转拼音（与 pnpm new-post 规则一致）
 */
function onTitleBlur() {
	if (sha !== null || loadedPath !== null) return;
	if (fileNameTouched) return;
	const base = fm.slug.trim() || fileNameToSlug(fm.title.trim());
	if (!base) return;
	fileName = `${todayDateString()}-${base}`;
	if (!fm.slug) fm.slug = base; // slug 不带日期前缀
}

function setUpdatedNow() {
	fm.updated = todayDateString();
}

function backToList() {
	// 与 beforeunload/swup 拦截同一口径：脏了先确认，防手滑丢稿
	if (dirty && !window.confirm("有未保存的修改，确定返回列表吗？")) return;
	view = "list";
	// 种子流（/write/?new=1）直接进编辑器、mount 时跳过了 loadList：返回列表补加载
	if (!listLoaded && !listLoading) void loadList();
}

function validateForSave(): string {
	if (!fm.title.trim()) return "标题（title）不能为空";
	if (!fm.published) return "发布日期（published）不能为空";
	// content schema 是 z.date()：非 ISO 日期会让 Cloudflare 构建整站炸掉，入口拦下
	if (fm.published && !/^\d{4}-\d{2}-\d{2}$/.test(fm.published))
		return "发布日期（published）格式应为 YYYY-MM-DD";
	if (fm.updated && !/^\d{4}-\d{2}-\d{2}$/.test(fm.updated))
		return "更新日期（updated）格式应为 YYYY-MM-DD";
	if (!fileName.trim()) return "文件名不能为空";
	// 批36：`\` 一律禁；`/` 仅嵌套路径文章放行（打开时文件名锁只读，路径忠实于
	// 远端）——新建与顶层改名仍禁 `/`（跨目录改名超出本轮）
	if (/\\/.test(fileName.trim())) return "文件名不能包含 \\";
	if (!nestedPost && fileName.trim().includes("/"))
		return "文件名不能包含 /（嵌套路径仅限已存在的子目录文章）";
	// 「未发布」「草稿」是保留分类名（分类条「草稿」入口专用，批37 入口改名后
	// 旧名一并保留拒绝），真分类不得占用，防构建期撞车
	if (
		fm.category.trim() === RESERVED_CATEGORY ||
		fm.category.trim() === RESERVED_CATEGORY_DRAFT
	) {
		return "「未发布」「草稿」是保留分类名（分类条入口专用），请换一个分类";
	}
	return "";
}

/** 把 tagsInput / seriesOrderInput / slug 兜底同步进 frontmatter（暂存与发布共用） */
function syncMetaInputs() {
	fm.tags = tagsInput
		.split(/[,，]/)
		.map((tag) => tag.trim())
		.filter(Boolean);
	// type="number" 的 bind:value 经 svelte to_number() 会把值变成 number（填过）或 null（清空），
	// 不能当字符串直接 .trim()，先归一化；非数字（Number NaN）也落 null，别写 NaN 进 frontmatter
	const orderText = seriesOrderInput == null ? "" : String(seriesOrderInput);
	const order = Number(orderText);
	fm.seriesOrder =
		orderText.trim() !== "" && Number.isFinite(order) ? order : null;
	if (!fm.slug) {
		// 文件名带 YYYY-MM-DD- 前缀，slug 不带（与 onTitleBlur 的建议口径一致）
		const fallback = fileNameToSlug(fileName.trim()).replace(
			/^\d{4}-\d{2}-\d{2}-/,
			"",
		);
		if (fallback) fm.slug = fallback;
	}
}

/** 暂存草稿：待上传图先传 write-drafts 本文子目录，再提交 md（[CI Skip]） */
async function saveDraft() {
	editorError = "";
	if (!isLoggedIn) {
		editorError = "只读模式：请先登录后再暂存草稿";
		return;
	}
	if (
		!fileName.trim() ||
		/\\/.test(fileName.trim()) ||
		(!nestedPost && fileName.trim().includes("/"))
	) {
		editorError = "暂存前先填好文件名：草稿按文件名存放在 write-drafts 分支";
		return;
	}
	if (savingDraft) return;
	savingDraft = true;
	try {
		syncMetaInputs();
		const path = currentPath;
		await ensureDraftsBranch(token);
		const prepared = await prepareImageSaves(
			token,
			`${fileName.trim()}.${fileExt}`,
			body,
			pendingImages,
			"draft",
			storedSnapshot,
		);
		body = prepared.body;
		applyImagePlan(prepared.plan);
		const outcome = await uploadPendingImages(
			token,
			prepared.plan.uploads,
			"draft",
			draftUploadedUrls,
			(done, total) => {
				imageUploadDone = done;
				imageUploadTotal = total;
			},
		);
		for (const url of outcome.uploadedUrls) draftUploadedUrls.add(url);
		const text = serializePostFile(fm, extras, body);
		const result = await saveDraftPost(
			token,
			path,
			text,
			fm.title.trim() || fileName.trim(),
		);
		draftSha = result.sha;
		draftBanner = null;
		draftIndex.set(path, `${fileName.trim()}.${fileExt}`);
		// 暂存时标题在手，直接写入分组缓存：返回列表零请求即显示标题
		const draftTitle = fm.title.trim();
		if (draftTitle) draftTitles.set(path, draftTitle);
		else draftTitles.delete(path); // 标题被清空：下次列表重查，回退文件名
		// 暂存收尾：清掉草稿分支不再被正文引用的插图（删引用行 = 删图即时生效）；
		// 改名搬运失败保全的文件在 keepPaths 里，绝不扫掉。
		// warnings（改名失败等）必须并入 toast，不能静默——否则仓库与正文脱节无人知晓
		const notes = [
			...prepared.warnings,
			...outcome.failed.map(
				(f) =>
					`插图 ${f.url.split("/").pop()} 上传失败（本地预览仍在，再点一次暂存可重试）：${f.reason}`,
			),
		];
		try {
			const sweep = await sweepDraftImages(
				token,
				`${fileName.trim()}.${fileExt}`,
				body,
				new Set(prepared.protectedDraftPaths),
			);
			notes.push(
				...sweep.failed.map(
					(name) => `草稿插图 ${name} 清理失败（不影响暂存，可稍后重试）`,
				),
			);
		} catch {
			/* 草稿插图目录读取失败不影响暂存结果 */
		}
		storedSnapshot = text;
		invalidateDraftCountCache();
		showToast(
			notes.length
				? `草稿已暂存；${notes.length} 项提示：${notes[0]}`
				: `草稿已暂存到 ${DRAFT_BRANCH} 分支，线上不受影响`,
		);
	} catch (error) {
		editorError = describeGitHubError(error);
		if (error instanceof GitHubError && error.kind === "unauthorized") {
			forceLogout("登录已失效，请重新登录");
		}
	} finally {
		savingDraft = false;
		imageUploadTotal = 0;
		imageUploadDone = 0;
	}
}

/** 载入暂存草稿到编辑器（master sha 保留：发布时覆盖已发布版本） */
async function loadDraftVersion() {
	if (!loadedPath || loadingDraft) return;
	loadingDraft = true;
	editorError = "";
	try {
		const file = await fetchDraftFile(token, loadedPath);
		if (!file) {
			draftBanner = null;
			return;
		}
		const parsed = parsePostFile(draftFileText(file));
		fm = parsed.frontmatter;
		body = parsed.body;
		extras = parsed.extras;
		draftSha = file.sha;
		draftBanner = null;
		tagsInput = fm.tags.join(", ");
		seriesOrderInput = fm.seriesOrder == null ? "" : String(fm.seriesOrder);
		storedSnapshot = serializePostFile(fm, extras, body);
		showToast("已载入暂存草稿，点「发布」才会更新线上");
	} catch (error) {
		editorError = describeGitHubError(error);
	} finally {
		loadingDraft = false;
	}
}

/** 丢弃暂存草稿（只删草稿分支文件，编辑器内容与已发布版本都不动） */
async function discardDraft() {
	if (!loadedPath || discardingDraft) return;
	if (
		!window.confirm(
			"确认丢弃这篇的暂存草稿？编辑器内容与已发布版本都不受影响。",
		)
	) {
		return;
	}
	discardingDraft = true;
	editorError = "";
	try {
		await deleteDraftFile(token, loadedPath);
		draftSha = null;
		draftBanner = null;
		draftIndex.delete(loadedPath);
		draftTitles.delete(loadedPath);
		invalidateDraftCountCache();
		showToast("暂存草稿已丢弃");
	} catch (error) {
		editorError = describeGitHubError(error);
	} finally {
		discardingDraft = false;
	}
}

/** 发布：待上传图先传 master（先图后文），再提交正文，最后清理草稿 */
async function save() {
	editorError = "";
	conflictPending = false;
	if (!isLoggedIn) {
		editorError = "只读模式：请先登录后再发布";
		return;
	}
	const invalid = validateForSave();
	if (invalid) {
		editorError = invalid;
		return;
	}
	if (saving) return;
	saving = true;
	try {
		syncMetaInputs();
		const path = currentPath;
		// 文件名被改过 → 按「另存为新文件」处理，不带旧 sha（旧文件保留）
		const effectiveSha = filenameChanged ? undefined : (sha ?? undefined);
		const prepared = await prepareImageSaves(
			token,
			`${fileName.trim()}.${fileExt}`,
			body,
			pendingImages,
			"master",
			storedSnapshot,
		);
		body = prepared.body;
		applyImagePlan(prepared.plan);
		const outcome = await uploadPendingImages(
			token,
			prepared.plan.uploads,
			"master",
			masterUploadedUrls,
			(done, total) => {
				imageUploadDone = done;
				imageUploadTotal = total;
			},
		);
		// 上传成功 → master 原生可见，移出待上传表（blob 回收；草稿副本由发布收尾清理）
		for (const url of outcome.uploadedUrls) {
			masterUploadedUrls.add(url);
			const entry = pendingImages.get(url);
			if (entry) {
				URL.revokeObjectURL(entry.objectUrl);
				pendingImages.delete(url);
			}
		}
		const text = serializePostFile(fm, extras, body);
		const { sha: newSha, warnings } = await publishPostFile(
			token,
			path,
			text,
			fm.title.trim(),
			effectiveSha,
			new Set(prepared.protectedDraftPaths),
		);
		sha = newSha;
		loadedPath = path;
		draftSha = null;
		draftBanner = null;
		draftIndex.delete(path);
		invalidateDraftCountCache();
		storedSnapshot = text;
		const allWarnings = [
			...prepared.warnings,
			...outcome.failed.map(
				(f) => `插图 ${f.url.split("/").pop()} 上传失败：${f.reason}`,
			),
			...warnings,
		];
		// 批36：勾选草稿保存 = 线上不可见（构建全站过滤 draft），toast 指路「草稿」入口（批37 改名）
		const savedAsDraft = fm.draft === true;
		showToast(
			allWarnings.length
				? `${savedAsDraft ? "已保存为草稿（线上不显示）" : "已发布"}；${allWarnings.length} 项收尾提示：${allWarnings[0]}`
				: savedAsDraft
					? "已保存为草稿：线上不显示，可在分类条「草稿」入口找到"
					: "已发布，Cloudflare 构建约 1-2 分钟后生效",
		);
		void loadList();
	} catch (error) {
		editorError = describeGitHubError(error);
		if (error instanceof GitHubError && error.kind === "conflict") {
			conflictPending = true;
		} else if (error instanceof GitHubError && error.kind === "unauthorized") {
			forceLogout("登录已失效，请重新登录");
		}
	} finally {
		saving = false;
		imageUploadTotal = 0;
		imageUploadDone = 0;
	}
}

/** 409 冲突：重拉远端最新内容，覆盖本地编辑 */
async function reloadRemote() {
	if (!loadedPath) return;
	editorError = "";
	conflictPending = false;
	editorLoading = true;
	try {
		const file = await fetchFile(token, loadedPath);
		const parsed = parsePostFile(file.text);
		fm = parsed.frontmatter;
		body = parsed.body;
		extras = parsed.extras;
		sha = file.sha;
		fileName = loadedPath.replace(/^.*\/([^/]+)\.(md|mdx)$/i, "$1");
		fileExt = /\.mdx$/i.test(loadedPath) ? "mdx" : "md";
		tagsInput = fm.tags.join(", ");
		seriesOrderInput = fm.seriesOrder == null ? "" : String(fm.seriesOrder);
		storedSnapshot = serializePostFile(fm, extras, body);
		showToast("已重载远端最新内容，请基于它修改后再保存");
	} catch (error) {
		editorError = describeGitHubError(error);
	} finally {
		editorLoading = false;
	}
}

/**
 * 删除（批37 补全双语义）：sha 在 = master 文章删除（confirm 含仓库名，
 * 暂存副本/插图残留一并清理）；sha 空 + draftSha 在 = 仅存于草稿分支的暂存
 * 草稿，只删 write-drafts 分支副本（此前这类草稿在编辑器无删除路径）；
 * 纯新建（两者皆空）按钮禁用，兜底不动作。
 */
async function removePost() {
	if (!loadedPath || deleting || !isLoggedIn) return;
	const label = fm.title.trim() || fileName;
	if (sha) {
		if (
			!window.confirm(
				`确认删除文章「${label}」？\n删除会直接提交到 GitHub（${WRITE_REPO.owner}/${WRITE_REPO.repo}@${WRITE_REPO.branch}），不可撤销。`,
			)
		) {
			return;
		}
	} else if (draftSha) {
		if (
			!window.confirm(
				`确认删除暂存草稿「${label}」？只删 ${DRAFT_BRANCH} 分支的副本，master 不受影响。`,
			)
		) {
			return;
		}
	} else {
		return; // 纯新建：按钮已禁用，走不到这里
	}
	deleting = true;
	editorError = "";
	try {
		if (sha) {
			await deleteFile(token, loadedPath, `write: 删除 ${label}`, sha);
		}
		// 暂存副本与本文插图子目录一并清理（都失败不影响删除本体）；
		// 仅存草稿时上面跳过 master 删除，这里的 deleteDraftFile 就是删除本体
		try {
			await deleteDraftFile(token, loadedPath);
		} catch {
			/* 忽略 */
		}
		try {
			await removeArticleDraftImages(
				token,
				loadedPath.slice(POSTS_DIR.length + 1),
			);
		} catch {
			/* 忽略 */
		}
		draftIndex.delete(loadedPath);
		draftTitles.delete(loadedPath);
		invalidateDraftCountCache();
		draftSha = null;
		draftBanner = null;
		showToast("已删除，正在返回列表");
		view = "list";
		await loadList();
	} catch (error) {
		editorError = describeGitHubError(error);
		if (error instanceof GitHubError && error.kind === "unauthorized") {
			forceLogout("登录已失效，请重新登录");
		}
	} finally {
		deleting = false;
	}
}

function readFileBase64(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			const result = String(reader.result ?? "");
			const comma = result.indexOf(",");
			resolve(comma === -1 ? result : result.slice(comma + 1));
		};
		reader.onerror = () => reject(new Error("读取图片文件失败"));
		reader.readAsDataURL(file);
	});
}

/** 待上传表登记；同 URL 重复插入时回收旧 blob，避免泄漏。
 * srcBase 盖章创建时的文件名基：live effect 按手改路径重键（键变新名）后，
 * 保存端 reconcileRefs ① 仍能据它批准 alt 跟随改名（批30 P1 返工）。 */
function stageImage(url: string, base64: string, objectUrl: string) {
	const existing = pendingImages.get(url);
	if (existing && existing.objectUrl !== objectUrl) {
		URL.revokeObjectURL(existing.objectUrl);
	}
	pendingImages.set(url, { base64, objectUrl, srcBase: urlFileNameBase(url) });
}

async function handleImageSelected(event: Event) {
	const input = event.currentTarget;
	if (!(input instanceof HTMLInputElement)) return;
	const file = input.files?.[0];
	input.value = ""; // 允许连续选同一张图
	if (!file) return;
	if (!isLoggedIn) {
		editorError = "只读模式：请先登录后再插入图片";
		return;
	}
	editorError = "";
	try {
		const base64 = await readFileBase64(file);
		// 弹命名卡：预填建议名（原文件名清洗），后缀固定；确认才进待上传表
		nameDialog = {
			base64,
			objectUrl: URL.createObjectURL(file),
			suggested: defaultImageName(file.name),
			ext: imageExtFrom(file),
		};
	} catch (error) {
		editorError = error instanceof Error ? error.message : String(error);
	}
}

/** 当前文章的插图公开目录；标题未定先用 untitled 占位，保存时归一化进正式目录 */
function articleDirUrl(): string {
	return imagePublicDirFor(`${fileName.trim() || "untitled"}.${fileExt}`);
}

/** 命名卡确认：登记待上传 + 光标处插入引用（图片未上传，URL 先按最终地址占位） */
async function confirmImageName(rawName: string) {
	const dialog = nameDialog;
	if (!dialog) return;
	nameDialog = null;
	const finalName = sanitizeImageName(rawName);
	const url = `${articleDirUrl()}/${finalName}${dialog.ext}`;
	stageImage(url, dialog.base64, dialog.objectUrl);
	await insertAtCursor(buildImageMarkdown(finalName, url));
	showToast("图片已插入正文（暂存/发布时随文上传，刷新前只存本浏览器）");
}

/** 命名卡取消：不插入不上传，回收本地预览 */
function cancelImageName() {
	if (nameDialog) URL.revokeObjectURL(nameDialog.objectUrl);
	nameDialog = null;
}

/**
 * Ctrl+V 直接粘图：多张逐一自动命名插入（时间戳-paste[-N]），事后可改正文路径重命名。
 * 监听挂在编辑器根容器上：焦点在预览/工具栏（如刚点完插入图片按钮）也能粘；
 * 元信息输入框与命名卡的输入框保持原生文本粘贴，不在编辑器界面时不接管。
 */
async function handlePaste(event: ClipboardEvent) {
	if (view !== "editor" || nameDialog) return;
	const target = event.target;
	// 元信息输入框与命名卡的输入框保持原生文本粘贴（CM 内容区是 contenteditable
	// div，不会命中；图片粘贴已在 cm-editor.ts 的 paste handler 里阻断原生行为）
	if (target instanceof HTMLInputElement) return;
	const images = imageFilesFromClipboard(event.clipboardData);
	if (images.length === 0) return;
	// 无登录态也拦下原生粘贴（避免把图片文件路径当文本粘进正文）
	event.preventDefault();
	if (!isLoggedIn) {
		editorError = "只读模式：请先登录后再粘贴图片";
		return;
	}
	editorError = "";
	const dirUrl = articleDirUrl();
	let index = 0;
	for (const file of images) {
		index++;
		try {
			const base64 = await readFileBase64(file);
			const ext = imageExtFrom(file);
			const base = `${timestampPrefix()}-paste${index > 1 ? `-${index}` : ""}`;
			let name = base;
			let url = `${dirUrl}/${name}${ext}`;
			// 同一秒内多次粘贴会撞名：追加序号避开覆盖
			while (pendingImages.has(url)) {
				name = `${base}-${++index}`;
				url = `${dirUrl}/${name}${ext}`;
			}
			stageImage(url, base64, URL.createObjectURL(file));
			await insertAtCursor(buildImageMarkdown(name, url));
		} catch (error) {
			editorError = error instanceof Error ? error.message : String(error);
			return;
		}
	}
	showToast(
		images.length > 1
			? `已粘贴 ${images.length} 张图片（暂存/发布时随文上传）`
			: "图片已插入正文（暂存/发布时随文上传）",
	);
}

async function insertAtCursor(text: string) {
	// CM 未就绪或宿主不可见（手机端预览页签）时退化为追加到文末：
	// 看不见的编辑器没有真实光标，dispatch 进去插入点错乱还会抢焦点
	if (!cmHandle || (cmHost?.offsetParent ?? null) === null) {
		body = `${body}${text}\n`;
		return;
	}
	cmHandle.insertAtCursor(text);
}
</script>

<div class="flex w-full flex-col gap-4" onpaste={(event) => void handlePaste(event)}>
		<!-- 未发布块（批37 抽成公共片段，批38 扁平化）：master 草稿与暂存草稿合并为
				单一扁平列表（用户口径：两者都是「没发布的暂存」，不再拆小节）。
				「草稿」徽标仅普通列表页（inDraftsPage=false）渲染，草稿页组头已表明语义；
				草稿页 master 行「有草稿」徽标（有暂存副本）保留；空态由外层条件兜住 -->
		{#snippet unpublishedGroup(inDraftsPage: boolean)}
			<div class="text-xs text-50 mb-1.5">
				未发布 · 线上不可见（{masterDraftItems.length + draftOnlyItems.length}）
			</div>
			<div class="divide-y divide-black/5 dark:divide-white/10">
				{#each masterDraftItems as item (item.path)}
					<button
						type="button"
						class="w-full flex flex-wrap items-center gap-x-4 gap-y-1.5 px-2 py-3 -mx-2 rounded-lg text-left hover:bg-(--btn-plain-bg-hover) transition-colors"
						onclick={() => void openPost(item)}
					>
						<span class="w-full md:w-auto md:max-w-[18rem] truncate font-mono text-xs text-50">
							{item.name}
						</span>
						<span class="flex-1 min-w-0 truncate text-sm text-90">
							{item.title}
						</span>
						{#if inDraftsPage && draftIndex.has(item.path)}
							<span
								class="shrink-0 text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400"
							>
								有草稿
							</span>
						{/if}
						{#if !inDraftsPage}
							<span
								class="shrink-0 text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400"
							>
								草稿
							</span>
						{/if}
					</button>
				{/each}
				{#each draftOnlyItems as draft (draft.path)}
					<button
						type="button"
						class="w-full flex flex-wrap items-center gap-x-4 gap-y-1.5 px-2 py-3 -mx-2 rounded-lg text-left hover:bg-(--btn-plain-bg-hover) transition-colors"
						onclick={() => void openDraftOnly(draft.path)}
					>
						<span class="flex-1 min-w-0 truncate text-sm text-90">
							{draftTitles.get(draft.path) ?? draft.name}
						</span>
						{#if !inDraftsPage}
							<span
								class="shrink-0 text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400"
							>
								草稿
							</span>
						{/if}
					</button>
				{/each}
			</div>
		{/snippet}
		{#if authChecking}
		<div class="card-base px-6 md:px-9 py-10 rounded-(--radius-large) text-center text-50">
			正在恢复登录状态……
		</div>
	{:else if view === "login"}
		<!-- 1. 登录卡（未登录首页态） -->
		<div class="card-base px-6 md:px-9 py-8 rounded-(--radius-large) max-w-xl mx-auto w-full">
			<div class="text-3xl font-bold text-90 mb-3">写作中心</div>
			<p class="text-sm text-50 leading-relaxed mb-6">
				输入 GitHub Personal Access Token 登录后，可以直接在博客里写文章：「暂存草稿」存到
				{WRITE_REPO.owner}/{WRITE_REPO.repo} 的 {DRAFT_BRANCH}
				分支（不影响线上），想上线时点「发布」提交 {WRITE_REPO.branch}
				分支，Cloudflare Pages 构建约 1-2 分钟后生效。token 需要仓库 Contents 读写权限（Fine-grained 勾选该仓库的
				Contents: Read and write，或 Classic 勾选 repo 范围）。
			</p>
			<input
				type="password"
				class={inputClass}
				placeholder="ghp_… / github_pat_…"
				bind:value={tokenInput}
				onkeydown={(event) => {
					if (event.key === "Enter") void handleLogin();
				}}
			>
			{#if loginError}
				<p class="text-sm text-(--primary) mt-3 leading-relaxed">{loginError}</p>
			{/if}
			<div class="flex flex-wrap gap-3 mt-5">
				<button
					type="button"
					class="btn-regular rounded-(--radius-large) px-6 h-10 text-sm"
					onclick={() => void handleLogin()}
					disabled={loginBusy || tokenInput.trim() === ""}
				>
					{loginBusy ? "验证中……" : "验证并登录"}
				</button>
				<button
					type="button"
					class="btn-plain rounded-(--radius-large) px-6 h-10 text-sm"
					onclick={browseAnonymous}
				>
					不登录，只读浏览
				</button>
			</div>
			<p class="text-xs text-50 mt-6 leading-relaxed">
				Token 仅保存在本浏览器的 localStorage，只发送给 GitHub API，不会出现在任何日志里。
			</p>
		</div>
	{:else if view === "list"}
		<!-- 2. 列表视图 -->
		<div class="card-base px-6 md:px-9 py-6 rounded-(--radius-large) w-full">
			<div class="flex flex-wrap items-center gap-3 mb-5">
				<div class="flex items-baseline gap-3 flex-1 min-w-0">
					<div class="text-2xl font-bold text-90">
						{draftsMode ? "草稿" : "文章列表"}
					</div>
					{#if draftsMode}
						<!-- 草稿页唯一出口（批37）：返回全量列表 -->
						<a href="/write/" class="text-xs text-50 hover:text-(--primary) transition-colors">
							全部文章
						</a>
					{/if}
				</div>
				{#if isLoggedIn}
					<span class="text-xs text-50">已登录：<span class="text-90">{userLogin}</span></span>
					<button
						type="button"
						class="btn-plain rounded-(--radius-large) px-4 h-9 text-xs"
						onclick={handleLogout}
					>
						登出
					</button>
				{:else}
					<span
						class="text-xs px-2.5 py-1 rounded-full border border-(--primary)/40 text-(--primary)"
					>
						只读
					</span>
					<button
						type="button"
						class="btn-plain rounded-(--radius-large) px-4 h-9 text-xs"
						onclick={() => (view = "login")}
					>
						去登录
					</button>
				{/if}
			</div>
			<div class="flex flex-wrap gap-3 mb-5">
				<button
					type="button"
					class="btn-regular rounded-(--radius-large) px-5 h-10 text-sm"
					onclick={newPost}
				>
					新建文章
				</button>
				<button
					type="button"
					class="btn-plain rounded-(--radius-large) px-5 h-10 text-sm"
					onclick={() => void loadList()}
					disabled={listLoading}
				>
					{listLoading ? "刷新中……" : "刷新"}
				</button>
			</div>

			{#if listLoading}
				<div class="py-10 text-center text-50 text-sm">
					正在从 GitHub 拉取文章列表……
					{#if listTotal > 0}
						（解析文章信息 {listDone}/{listTotal}）
					{/if}
				</div>
			{:else if listError}
				<div class="py-8 text-center">
					<p class="text-sm text-(--primary) mb-4">{listError}</p>
					<button
						type="button"
						class="btn-regular rounded-(--radius-large) px-5 h-9 text-xs"
						onclick={() => void loadList()}
					>
						重试
					</button>
				</div>
			{:else if draftsMode}
				<!-- 草稿页（批38）：已发布副本块与未发布块各自非空才渲染（不再渲染空分类占位），
						两块全空收敛为单行「暂无草稿」（toast 仍由 focusDraftGroup 三空判定触发） -->
				{#if !isLoggedIn}
					<div class="py-8 text-center text-50 text-sm border-b border-black/5 dark:border-white/10">
						登录后可见草稿
					</div>
					<div class="py-8 text-center text-50 text-sm">
						登录后可见草稿
					</div>
				{:else if publishedWithDraftItems.length === 0 && masterDraftItems.length === 0 && draftOnlyItems.length === 0}
					<div class="py-10 text-center text-50 text-sm">暂无草稿</div>
				{:else}
					{#if publishedWithDraftItems.length > 0}
						<!-- 块一：已发布且有暂存草稿的文章（发布/丢弃后副本消失，自动离开本块；空时整块隐藏） -->
						<div id="published-drafts-block">
							<div class="text-xs text-50 mb-1.5">
								已发布 · 有暂存草稿（{publishedWithDraftItems.length}）
							</div>
							<div class="text-xs text-50 mb-1">
								线上显示的是已发布版本，下面这些改动还没发布；点开可继续编辑或发布
							</div>
							<div class="divide-y divide-black/5 dark:divide-white/10">
								{#each publishedWithDraftItems as item (item.path)}
									<button
										type="button"
										class="w-full flex flex-wrap items-center gap-x-4 gap-y-1.5 px-2 py-3 -mx-2 rounded-lg text-left hover:bg-(--btn-plain-bg-hover) transition-colors"
										onclick={() => void openPost(item)}
									>
										<span class="w-full md:w-auto md:max-w-[18rem] truncate font-mono text-xs text-50">
											{item.name}
										</span>
										<span class="flex-1 min-w-0 truncate text-sm text-90">
											{item.title}
										</span>
										<span
											class="shrink-0 text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400"
										>
											有草稿
										</span>
										<span class="shrink-0 text-xs text-50 tabular-nums">
											{item.published || "—"}
										</span>
									</button>
								{/each}
							</div>
						</div>
					{/if}
					{#if masterDraftItems.length > 0 || draftOnlyItems.length > 0}
						<!-- 块二：未发布（master 草稿 + 暂存草稿），与全量列表共用片段；块一可见时保留分割线，否则去掉避免顶部孤线 -->
						<div
							id={DRAFT_GROUP_ID}
							class={publishedWithDraftItems.length > 0
								? "mt-5 pt-4 border-t border-black/5 dark:border-white/10"
								: ""}
						>
							{@render unpublishedGroup(true)}
						</div>
					{/if}
				{/if}
			{:else if listItems.length === 0}
				<!-- 空状态：当前仓库 0 篇属预期 -->
				<div class="py-10 text-center text-50 text-sm leading-relaxed">
					<p>仓库里还没有文章（当前 0 篇属预期，演示文章已移出）。</p>
					{#if isLoggedIn}
						<p>点上方「新建文章」写下第一篇。</p>
					{:else}
						<p>当前为只读模式，登录后即可新建第一篇文章。</p>
					{/if}
				</div>
			{:else}
				<div class="divide-y divide-black/5 dark:divide-white/10">
					{#each listItems as item (item.path)}
						<button
							type="button"
							class="w-full flex flex-wrap items-center gap-x-4 gap-y-1.5 px-2 py-3 -mx-2 rounded-lg text-left hover:bg-(--btn-plain-bg-hover) transition-colors"
							onclick={() => void openPost(item)}
						>
							<span class="w-full md:w-auto md:max-w-[18rem] truncate font-mono text-xs text-50">
								{item.name}
							</span>
							<span class="flex-1 min-w-0 truncate text-sm text-90">
								{item.title}
							</span>
							<span
								class={`shrink-0 text-xs px-2 py-0.5 rounded-full ${
									item.draft
										? "border border-black/10 dark:border-white/15 text-50"
										: "bg-(--primary)/10 text-(--primary)"
								}`}
							>
								{item.draft ? "草稿" : "已发布"}
							</span>
							{#if isLoggedIn && draftIndex.has(item.path)}
								<span
									class="shrink-0 text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400"
								>
									有草稿
								</span>
							{/if}
							<span class="shrink-0 text-xs text-50 tabular-nums">
								{item.published || "—"}
							</span>
						</button>
					{/each}
				</div>
				{#if isLoggedIn && (masterDraftItems.length > 0 || draftOnlyItems.length > 0)}
					<div id={DRAFT_GROUP_ID} class="mt-5 pt-4 border-t border-black/5 dark:border-white/10">
						{@render unpublishedGroup(false)}
					</div>
				{/if}
			{/if}
		</div>
	{:else}
		<!-- 3. 编辑视图 -->
		<div class="card-base px-6 md:px-9 py-6 rounded-(--radius-large) w-full">
			<!-- 工具条 -->
			<div class="flex flex-wrap items-center gap-3 mb-5">
				<button
					type="button"
					class="btn-plain rounded-(--radius-large) px-4 h-9 text-xs"
					onclick={backToList}
				>
					← 返回列表
				</button>
				<button
					type="button"
					class="btn-plain rounded-(--radius-large) px-4 h-9 text-xs {vimOn
						? "text-(--primary)"
						: ""}"
					onclick={() => void toggleVim()}
					title="Vim 模式（hjkl 移动 / dd 删行 / i 插入）；偏好存本浏览器，刷新保持"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="13"
						height="13"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2.2"
						stroke-linecap="round"
						stroke-linejoin="round"
						class="mr-1 inline-block align-[-2px]"
						aria-hidden="true"
					>
						<path d="m4 17 6-6-6-6"></path>
						<path d="M12 19h8"></path>
					</svg>
					Vim {vimOn ? "开" : "关"}
				</button>
				<button
					type="button"
					class="btn-plain rounded-(--radius-large) px-4 h-9 text-xs relative"
					onclick={() => (configOpen = true)}
					title="编辑器 lua 配置（tab 宽度 / 键位映射 / vim / 布局）"
				>
					配置
					{#if luaStatus.state === "error"}
						<span
							class="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-red-600"
							title={luaStatus.message}
						></span>
					{/if}
				</button>
				<span class="flex-1"></span>
				<span
					class="text-xs px-2.5 py-1 rounded-full border border-black/10 dark:border-white/15 text-50"
				>
					{sha ? (filenameChanged ? "另存为新文件" : "已有文件") : "新文章"}
				</span>
				{#if !isLoggedIn}
					<span
						class="text-xs px-2.5 py-1 rounded-full border border-(--primary)/40 text-(--primary)"
					>
						只读
					</span>
				{/if}
				<input
					type="file"
					accept="image/*"
					class="hidden"
					bind:this={imageInput}
					onchange={(event) => void handleImageSelected(event)}
				>
				<button
					type="button"
					class="btn-plain rounded-(--radius-large) px-4 h-9 text-xs"
					onclick={() => imageInput?.click()}
					disabled={!isLoggedIn}
					title={isLoggedIn
						? "图片先存浏览器内存，暂存/发布时随文上传"
						: "登录后才能插入图片"}
				>
					插入图片
				</button>
				<button
					type="button"
					class="btn-plain rounded-(--radius-large) px-4 h-9 text-xs hover:text-red-500"
					onclick={() => void removePost()}
					disabled={(!sha && !draftSha) || !loadedPath || !isLoggedIn || deleting}
					title={
						!isLoggedIn
							? "登录后才能删除"
							: sha
								? `删除文章（直接提交 ${WRITE_REPO.branch} 分支，不可撤销）`
								: draftSha
									? "删除暂存草稿（只删 write-drafts 分支副本，master 不受影响）"
									: ""
					}
				>
					{deleting ? "删除中……" : "删除"}
				</button>
				<button
					type="button"
					class="btn-plain rounded-(--radius-large) px-4 h-9 text-xs"
					onclick={() => void saveDraft()}
					disabled={!isLoggedIn || savingDraft}
					title={isLoggedIn
						? `暂存到 ${DRAFT_BRANCH} 分支，不影响线上`
						: "登录后才能暂存"}
				>
					{savingDraft
						? (imageUploadTotal > 0
							? `上传插图 ${imageUploadDone}/${imageUploadTotal}……`
							: "暂存中……")
						: "暂存草稿"}
				</button>
				<button
					type="button"
					class="btn-regular rounded-(--radius-large) px-6 h-9 text-sm"
					onclick={() => void save()}
					disabled={!isLoggedIn || saving}
					title={!isLoggedIn
						? "登录后才能发布"
						: fm.draft
							? "保存为草稿：提交到 master，线上不显示；取消勾选「草稿」后点此发布"
							: "提交到 master 分支并触发 Cloudflare 构建（约 1-2 分钟上线）"}
				>
					{saving
						? (imageUploadTotal > 0
							? `上传插图 ${imageUploadDone}/${imageUploadTotal}……`
							: fm.draft
								? "保存中……"
								: "发布中……")
						: fm.draft
							? "保存草稿"
							: "发布"}
				</button>
			</div>

			{#if draftBanner && !editorLoading && !editorError}
				<div
					class="mb-5 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-75 flex flex-wrap items-center gap-3"
				>
					<span class="flex-1 min-w-0 leading-relaxed">
						这篇有未发布的暂存草稿（保存于 {draftBanner}），内容与当前版本不同。可继续编辑当前内容，或载入草稿。
					</span>
					<button
						type="button"
						class="btn-regular rounded-(--radius-large) px-4 h-8 text-xs shrink-0"
						onclick={() => void loadDraftVersion()}
						disabled={loadingDraft}
					>
						{loadingDraft ? "载入中……" : "载入草稿"}
					</button>
					<button
						type="button"
						class="btn-plain rounded-(--radius-large) px-4 h-8 text-xs shrink-0 hover:text-red-500"
						onclick={() => void discardDraft()}
						disabled={discardingDraft}
					>
						{discardingDraft ? "丢弃中……" : "丢弃草稿"}
					</button>
					<button
						type="button"
						class="btn-plain rounded-(--radius-large) px-3 h-8 text-xs shrink-0"
						onclick={() => (draftBanner = null)}
					>
						忽略
					</button>
				</div>
			{/if}

			{#if editorError}
				<div
					class="mb-5 rounded-lg border border-(--primary)/30 bg-(--primary)/5 px-4 py-3 text-sm text-75 flex flex-wrap items-center gap-3"
				>
					<span class="flex-1 min-w-0 leading-relaxed">{editorError}</span>
					{#if conflictPending}
						<button
							type="button"
							class="btn-regular rounded-(--radius-large) px-4 h-8 text-xs shrink-0"
							onclick={() => void reloadRemote()}
						>
							重载远端
						</button>
					{/if}
				</div>
			{/if}

			{#if editorLoading}
				<div class="py-16 text-center text-50 text-sm">正在加载文章内容……</div>
			{:else}
				<!-- frontmatter 折叠表单 -->
				{#if showFrontmatter}
					<div class="write-surface grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 pb-5 mb-5 border-b border-black/5 dark:border-white/10">
						<div class="md:col-span-2">
							<label class={labelClass} for="we-title">标题（title） *</label>
							<input
								id="we-title"
								type="text"
								class={inputClass}
								placeholder="文章标题"
								bind:value={fm.title}
								onblur={onTitleBlur}
							>
						</div>
						<div>
							<label class={labelClass} for="we-published">发布日期（published） *</label>
							<DateField id="we-published" inputClass={inputClass} bind:value={fm.published} />
						</div>
						<div>
							<label class={labelClass} for="we-updated">更新日期（updated）</label>
							<div class="flex gap-2">
								<DateField id="we-updated" inputClass={inputClass} bind:value={fm.updated} />
								<button
									type="button"
									class="btn-plain rounded-lg px-3 h-9 text-xs shrink-0"
									onclick={setUpdatedNow}
								>
									设为现在
								</button>
							</div>
						</div>
						<div class="md:col-span-2">
							<label class={labelClass} for="we-description">摘要（description）</label>
							<input
								id="we-description"
								type="text"
								class={inputClass}
								placeholder="用于列表与 meta 的简短描述"
								bind:value={fm.description}
							>
						</div>
						<div class="md:col-span-2">
							<label class={labelClass} for="we-image">封面图（image）</label>
							<input
								id="we-image"
								type="text"
								class={inputClass}
								placeholder="/assets/images/posts/… 或完整 URL"
								bind:value={fm.image}
							>
							<p class="text-xs text-50 mt-1">文章封面图地址，可上传后粘贴，或留空继承主题默认。</p>
						</div>
						<div>
							<label class={labelClass} for="we-tags">标签（tags，逗号分隔）</label>
							<input
								id="we-tags"
								type="text"
								class={inputClass}
								placeholder="随笔, 技术"
								bind:value={tagsInput}
							>
						</div>
						<div>
							<label class={labelClass} for="we-category">分类（category）</label>
							<input
								id="we-category"
								type="text"
								class={inputClass}
								placeholder="如：日常"
								bind:value={fm.category}
							>
						</div>
						<div>
							<label class={labelClass} for="we-author">作者（author）</label>
							<input
								id="we-author"
								type="text"
								class={inputClass}
								placeholder="留空使用站点默认"
								bind:value={fm.author}
							>
						</div>
						<div>
							<label class={labelClass} for="we-series">系列（series）</label>
							<input
								id="we-series"
								type="text"
								class={inputClass}
								placeholder="系列名，非系列文章留空"
								bind:value={fm.series}
							>
						</div>
						<div>
							<label class={labelClass} for="we-series-order">系列序号（seriesOrder，可空）</label>
							<input
								id="we-series-order"
								type="number"
								class={inputClass}
								placeholder="如 1"
								bind:value={seriesOrderInput}
							>
						</div>
						<div>
							<label class={labelClass} for="we-slug">slug（URL 标识，留空自动生成）</label>
							<input
								id="we-slug"
								type="text"
								class={inputClass}
								placeholder="wo-de-di-yi-pian-wen-zhang"
								bind:value={fm.slug}
							>
						</div>
						<div class="md:col-span-2">
							<label class={labelClass} for="we-filename">文件名（不含扩展名）</label>
							<div class="flex items-center gap-2">
								<input
									id="we-filename"
									type="text"
									class={`${inputClass} font-mono`}
									placeholder="YYYY-MM-DD-标题拼音（自动建议）"
									bind:value={fileName}
									oninput={() => (fileNameTouched = true)}
									readonly={nestedPost}
								>
								<span class="text-xs text-50 shrink-0 font-mono">.{fileExt}</span>
							</div>
							<p class="text-xs text-50 mt-1">
								新建时按标题自动建议（中文转拼音，与 pnpm new-post 规则一致），可随时手改。{#if sha}改动文件名将另存为新文件，原文件保留。{/if}{#if nestedPost}嵌套路径文章暂不支持改名（跨目录移动超出本轮）。{/if}
							</p>
						</div>
						<div class="flex items-center gap-6 pt-1">
							<label class="flex items-center gap-2 text-sm text-75 cursor-pointer">
								<input type="checkbox" class="accent-(--primary) w-4 h-4" bind:checked={fm.draft}>
								草稿（draft，不对外发布）
							</label>
							<label class="flex items-center gap-2 text-sm text-75 cursor-pointer">
								<input type="checkbox" class="accent-(--primary) w-4 h-4" bind:checked={fm.pinned}>
								置顶（pinned）
							</label>
						</div>
					</div>
				{/if}

				<!-- 窄屏 tab 切换不动 / ≥md 三态布局（P3：仅编辑/双窗/仅预览） -->
				<div class="flex gap-2 mb-4 md:hidden">
					<button
						type="button"
						class="flex-1 h-9 text-sm rounded-lg border border-black/10 dark:border-white/10 text-75 transition-colors {mobileTab ===
						"edit"
							? "bg-(--btn-plain-bg-hover) text-(--primary)"
							: ""}"
						onclick={() => (mobileTab = "edit")}
					>
						编辑
					</button>
					<button
						type="button"
						class="flex-1 h-9 text-sm rounded-lg border border-black/10 dark:border-white/10 text-75 transition-colors {mobileTab ===
						"preview"
							? "bg-(--btn-plain-bg-hover) text-(--primary)"
							: ""}"
						onclick={() => (mobileTab = "preview")}
					>
						预览
					</button>
				</div>
				<!-- relative：三态按钮轨绝对定位在预览卡右外沿（外卡 px-9 内边距空间内，不溢出容器） -->
				<div
					class="relative grid grid-cols-1 {layout === "split"
						? "md:grid-cols-2"
						: "md:grid-cols-1"} gap-4 items-start"
				>
					<div
						class="card-base px-4 h-[80vh] w-full {mobileTab === "edit" ? "" : "hidden"} {layout ===
						"preview"
							? "md:hidden!"
							: "md:block!"}"
					>
						<!-- CM6 编辑器（P5 缩进竖线 / P6 续行 / P7 vim），宿主只管挂载 -->
						<div
							bind:this={cmHost}
							class="write-cm h-full text-75"
						></div>
					</div>
					<div
						bind:this={previewCard}
						class="card-base px-6 md:px-9 pt-6 pb-4 h-[80vh] overflow-y-auto custom-scrollbar w-full {mobileTab ===
						"preview"
							? ""
							: "hidden"} {layout === "edit"
							? "md:hidden!"
							: "md:block!"} {layout === "preview"
							? "md:h-auto md:overflow-visible"
							: ""}"
					>
						{#if preview.error}
							<p class="text-sm text-(--primary)">预览渲染出错：{preview.error}</p>
						{:else if !previewRenderer}
							<p class="text-sm text-50" aria-busy="true">正在加载预览……</p>
						{:else}
							<!-- 站点同款排版（markdown.css / markdown-extend.styl 由 write.astro 引入） -->
							<div class="prose dark:prose-invert prose-base max-w-none! custom-md">
								{@html preview.html}
							</div>
						{/if}
					</div>
					<!-- 三态按钮轨：<md 隐藏（移动端仍是 tab），≥md 竖排三枚 -->
					<div
						class="absolute left-full top-0 ml-1.5 hidden md:flex md:flex-col gap-1.5"
						role="group"
						aria-label="编辑器布局切换"
					>
						{#each layoutButtons as btn (btn.value)}
							<button
								type="button"
								class="w-7 h-7 rounded-md flex items-center justify-center border transition-colors {layout ===
								btn.value
									? "border-(--primary)/50 bg-(--primary)/10 text-(--primary)"
									: "border-black/10 dark:border-white/15 text-50 hover:bg-(--btn-plain-bg-hover)"}"
								onclick={() => setLayout(btn.value)}
								aria-label={btn.label}
								aria-pressed={layout === btn.value}
								title={btn.label}
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									width="14"
									height="14"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
									aria-hidden="true"
								>
									<rect x="3" y="4" width="18" height="16" rx="2"></rect>
									{#if btn.value === "edit"}
										<rect
											x="5.5"
											y="6.5"
											width="6"
											height="11"
											rx="1"
											fill="currentColor"
											stroke="none"
										></rect>
									{:else if btn.value === "split"}
										<line x1="12" y1="4" x2="12" y2="20"></line>
									{:else}
										<rect
											x="12.5"
											y="6.5"
											width="6"
											height="11"
											rx="1"
											fill="currentColor"
											stroke="none"
										></rect>
									{/if}
								</svg>
							</button>
						{/each}
					</div>
				</div>
			{/if}
		</div>
	{/if}

	<!-- 插图命名卡（选图后弹出，确认才插入正文） -->
	{#if nameDialog}
		<ImageNameDialog
			previewUrl={nameDialog.objectUrl}
			suggested={nameDialog.suggested}
			ext={nameDialog.ext}
			onconfirm={(name) => void confirmImageName(name)}
			oncancel={cancelImageName}
		/>
	{/if}

	<!-- 编辑器 lua 配置弹层（批31）：文件树 + CM6 编辑 + 保存/重载热应用 -->
	<ConfigDialog
		bind:open={configOpen}
		{token}
		editorHandle={cmHandle}
		onClose={() => (configOpen = false)}
	/>

	<!-- toast -->
	{#if notice}
		<div
			use:portalToBody
			class="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 card-base px-5 py-3 text-sm text-75 shadow-lg"
		>
			{notice}
		</div>
	{/if}
</div>
