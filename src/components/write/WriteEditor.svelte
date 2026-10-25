<script lang="ts">
/**
 * /write 写作中心：token 登录 → 文章列表（匿名只读）→ 左编辑右预览 →
 * 保存 / 删除 / 插图直接走 GitHub Contents API 提交到 master，
 * Cloudflare Pages 自动构建上线。全部状态在客户端，无后端。
 */
import { marked } from "marked";
import sanitizeHtml from "sanitize-html";
import { onMount, tick } from "svelte";
import { clearVerified, markVerified, resolveToken } from "@/utils/write/auth";
import {
	emptyFrontmatter,
	type PostFrontmatter,
	parsePostFile,
	serializePostFile,
} from "@/utils/write/frontmatter";
import {
	deleteFile,
	describeGitHubError,
	fetchCurrentUser,
	fetchFile,
	GitHubError,
	IMAGE_PUBLIC_PREFIX,
	listPostFiles,
	POSTS_DIR,
	putFile,
	putImageBase64,
	WRITE_REPO,
} from "@/utils/write/github";
import { persistToken } from "@/utils/write/session";
import {
	fileNameToSlug,
	timestampPrefix,
	todayDateString,
} from "@/utils/write/slug";

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

![示例图片说明](/assets/images/posts/example-cover.jpg)

\`\`\`ts
// 围栏代码块示例（构建后由 expressive-code 高亮，预览为普通样式）
export function greet(name: string): string {
	return \`你好，\${name}\`;
}
\`\`\`

> 引用：替换为正文内容，保存后约 1-2 分钟自动上线。
`;

const inputClass =
	"w-full px-3 py-2 text-sm bg-transparent border border-black/10 dark:border-white/10 rounded-lg focus:ring-2 focus:ring-(--primary) focus:border-(--primary) hover:border-black/20 dark:hover:border-white/20 text-75 placeholder:opacity-50 transition-colors outline-hidden";

const labelClass = "block text-xs font-medium text-50 mb-1";

const sanitizeConfig: sanitizeHtml.Options = {
	allowedTags: [
		...sanitizeHtml.defaults.allowedTags,
		"img",
		"input",
		"del",
		"ins",
		"mark",
		"figure",
		"figcaption",
		"kbd",
		"sup",
		"sub",
	],
	allowedAttributes: {
		...sanitizeHtml.defaults.allowedAttributes,
		a: ["href", "title", "target", "rel"],
		img: ["src", "alt", "title", "width", "height", "loading"],
		input: ["type", "checked", "disabled"],
		code: ["class"],
		span: ["class"],
		pre: ["class"],
		div: ["class"],
	},
	allowedSchemes: ["http", "https", "mailto"],
};

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
let seriesOrderInput = $state("");
let showFrontmatter = $state(true);
let mobileTab = $state<"edit" | "preview">("edit");
let editorLoading = $state(false);
let editorError = $state("");
let conflictPending = $state(false);
let saving = $state(false);
let deleting = $state(false);
let uploadingImage = $state(false);
let bodyTextarea = $state<HTMLTextAreaElement | null>(null);
let imageInput = $state<HTMLInputElement | null>(null);

const isLoggedIn = $derived(userLogin !== null && token !== "");
const currentPath = $derived(
	fileName.trim() ? `${POSTS_DIR}/${fileName.trim()}.${fileExt}` : "",
);
const filenameChanged = $derived(
	loadedPath !== null && currentPath !== "" && currentPath !== loadedPath,
);

const preview = $derived.by(() => {
	if (editorLoading) return { html: "", error: "" };
	try {
		const html = marked.parse(body, { async: false, gfm: true });
		if (typeof html !== "string")
			return { html: "", error: "预览返回异常结果" };
		return { html: sanitizeHtml(html, sanitizeConfig), error: "" };
	} catch (error) {
		return {
			html: "",
			error: error instanceof Error ? error.message : String(error),
		};
	}
});

function showToast(text: string) {
	notice = text;
	if (noticeTimer !== undefined) clearTimeout(noticeTimer);
	noticeTimer = setTimeout(() => {
		notice = "";
	}, 4000);
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
	// 复用自身或 /admin（Sveltia）登录态的 token；验证通过时顺带刷新入口门控缓存
	const saved = resolveToken();
	if (!saved) {
		authChecking = false;
		return;
	}
	token = saved;
	fetchCurrentUser(saved)
		.then((user) => {
			userLogin = user.login;
			markVerified(saved);
			if (wantsNewPost()) {
				newPost();
				return;
			}
			view = "list";
			void loadList();
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

async function handleLogin() {
	const value = tokenInput.trim();
	if (!value || loginBusy) return;
	loginBusy = true;
	loginError = "";
	try {
		const user = await fetchCurrentUser(value);
		storeToken(value);
		markVerified(value);
		userLogin = user.login;
		tokenInput = "";
		if (wantsNewPost()) {
			newPost();
			return;
		}
		view = "list";
		await loadList();
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
	try {
		const files = await listPostFiles(token);
		listTotal = files.length;
		const items: ListItem[] = [];
		const queue = [...files];
		const worker = async () => {
			for (;;) {
				const file = queue.shift();
				if (!file) break;
				try {
					const { text } = await fetchFile(token, file.path);
					const parsed = parsePostFile(text);
					items.push({
						name: file.name,
						path: file.path,
						sha: file.sha,
						title: parsed.frontmatter.title || file.name,
						draft: parsed.frontmatter.draft,
						published: parsed.frontmatter.published,
					});
				} catch {
					// 单篇解析失败不阻塞列表：退化为只展示文件名
					items.push({
						name: file.name,
						path: file.path,
						sha: file.sha,
						title: file.name,
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
	view = "editor";
	if (seed?.title) onTitleBlur();
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
	} catch (error) {
		editorError = describeGitHubError(error);
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
	view = "list";
}

function validateForSave(): string {
	if (!fm.title.trim()) return "标题（title）不能为空";
	if (!fm.published) return "发布日期（published）不能为空";
	if (!fileName.trim()) return "文件名不能为空";
	if (!/^[^/\\]+$/.test(fileName.trim()))
		return "文件名不能包含 / 或 \\（多级目录暂不支持）";
	return "";
}

async function save() {
	editorError = "";
	conflictPending = false;
	if (!isLoggedIn) {
		editorError = "只读模式：请先登录后再保存";
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
		fm.tags = tagsInput
			.split(/[,，]/)
			.map((tag) => tag.trim())
			.filter(Boolean);
		fm.seriesOrder =
			seriesOrderInput.trim() === "" ? null : Number(seriesOrderInput);
		if (!fm.slug) {
			// 文件名带 YYYY-MM-DD- 前缀，slug 不带（与 onTitleBlur 的建议口径一致）
			const fallback = fileNameToSlug(fileName.trim()).replace(
				/^\d{4}-\d{2}-\d{2}-/,
				"",
			);
			if (fallback) fm.slug = fallback;
		}

		const path = currentPath;
		// 文件名被改过 → 按「另存为新文件」处理，不带旧 sha（旧文件保留）
		const effectiveSha = filenameChanged ? undefined : (sha ?? undefined);
		const result = await putFile(
			token,
			path,
			serializePostFile(fm, extras, body),
			`write: ${fm.title.trim()}`,
			effectiveSha,
		);
		sha = result.sha;
		loadedPath = path;
		showToast("已提交，Cloudflare 构建约 1-2 分钟后生效");
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
		showToast("已重载远端最新内容，请基于它修改后再保存");
	} catch (error) {
		editorError = describeGitHubError(error);
	} finally {
		editorLoading = false;
	}
}

async function removePost() {
	if (!loadedPath || !sha || deleting) return;
	const label = fm.title.trim() || fileName;
	if (
		!window.confirm(
			`确认删除文章「${label}」？\n删除会直接提交到 GitHub（${WRITE_REPO.owner}/${WRITE_REPO.repo}@${WRITE_REPO.branch}），不可撤销。`,
		)
	) {
		return;
	}
	deleting = true;
	editorError = "";
	try {
		await deleteFile(token, loadedPath, `write: 删除 ${label}`, sha);
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

async function handleImageSelected(event: Event) {
	const input = event.currentTarget;
	if (!(input instanceof HTMLInputElement)) return;
	const file = input.files?.[0];
	input.value = ""; // 允许连续选同一张图
	if (!file) return;
	if (!isLoggedIn) {
		editorError = "只读模式：请先登录后再上传图片";
		return;
	}
	uploadingImage = true;
	editorError = "";
	try {
		const base64 = await readFileBase64(file);
		const safeName = file.name
			.toLowerCase()
			.replace(/[^a-z0-9.\-_]/g, "-")
			.replace(/-+/g, "-")
			.replace(/^-|-$/g, "");
		const uploadName = `${timestampPrefix()}-${safeName || "image"}`;
		await putImageBase64(
			token,
			uploadName,
			base64,
			`write: 上传图片 ${uploadName}`,
		);
		const alt = file.name.replace(/[[\]]/g, "");
		await insertAtCursor(
			`![${alt}](${IMAGE_PUBLIC_PREFIX}/${encodeURI(uploadName)})`,
		);
		showToast("图片已上传并插入正文");
	} catch (error) {
		editorError = describeGitHubError(error);
		if (error instanceof GitHubError && error.kind === "unauthorized") {
			forceLogout("登录已失效，请重新登录");
		}
	} finally {
		uploadingImage = false;
	}
}

async function insertAtCursor(text: string) {
	const el = bodyTextarea;
	if (!el) {
		body = `${body}${text}\n`;
		return;
	}
	const start = el.selectionStart ?? body.length;
	const end = el.selectionEnd ?? body.length;
	const before = body.slice(0, start);
	const after = body.slice(end);
	const prefix = before === "" || before.endsWith("\n") ? "" : "\n\n";
	const inserted = `${prefix}${text}\n`;
	body = `${before}${inserted}${after}`;
	await tick();
	const pos = before.length + inserted.length;
	el.focus();
	el.setSelectionRange(pos, pos);
}
</script>

<div class="flex w-full flex-col gap-4">
	{#if authChecking}
		<div class="card-base px-6 md:px-9 py-10 rounded-(--radius-large) text-center text-50">
			正在恢复登录状态……
		</div>
	{:else if view === "login"}
		<!-- 1. 登录卡（未登录首页态） -->
		<div class="card-base px-6 md:px-9 py-8 rounded-(--radius-large) max-w-xl mx-auto w-full">
			<div class="text-3xl font-bold text-90 mb-3">写作中心</div>
			<p class="text-sm text-50 leading-relaxed mb-6">
				输入 GitHub Personal Access Token 登录后，可以直接在博客里写文章：保存即提交到
				{WRITE_REPO.owner}/{WRITE_REPO.repo} 的 {WRITE_REPO.branch}
				分支，Cloudflare Pages 自动构建上线。token 需要仓库 Contents 读写权限（Fine-grained 勾选该仓库的
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
				<div class="text-2xl font-bold text-90 flex-1 min-w-0">文章列表</div>
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
							<span class="shrink-0 text-xs text-50 tabular-nums">
								{item.published || "—"}
							</span>
						</button>
					{/each}
				</div>
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
					class="btn-plain rounded-(--radius-large) px-4 h-9 text-xs"
					onclick={() => (showFrontmatter = !showFrontmatter)}
				>
					{showFrontmatter ? "收起文章信息" : "展开文章信息"}
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
					disabled={!isLoggedIn || uploadingImage}
					title={isLoggedIn ? "" : "登录后才能上传图片"}
				>
					{uploadingImage ? "上传中……" : "插入图片"}
				</button>
				<button
					type="button"
					class="btn-plain rounded-(--radius-large) px-4 h-9 text-xs hover:text-red-500"
					onclick={() => void removePost()}
					disabled={!sha || !loadedPath || !isLoggedIn || deleting}
					title={isLoggedIn ? "" : "登录后才能删除"}
				>
					{deleting ? "删除中……" : "删除"}
				</button>
				<button
					type="button"
					class="btn-regular rounded-(--radius-large) px-6 h-9 text-sm"
					onclick={() => void save()}
					disabled={!isLoggedIn || saving}
					title={isLoggedIn ? "" : "登录后才能保存"}
				>
					{saving ? "保存中……" : "保存"}
				</button>
			</div>

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
					<div class="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 pb-5 mb-5 border-b border-black/5 dark:border-white/10">
						<div class="md:col-span-2">
							<label class={labelClass} for="we-title">标题（title）＊</label>
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
							<label class={labelClass} for="we-published">发布日期（published）＊</label>
							<input id="we-published" type="date" class={inputClass} bind:value={fm.published}>
						</div>
						<div>
							<label class={labelClass} for="we-updated">更新日期（updated）</label>
							<div class="flex gap-2">
								<input id="we-updated" type="date" class={inputClass} bind:value={fm.updated}>
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
								>
								<span class="text-xs text-50 shrink-0 font-mono">.{fileExt}</span>
							</div>
							<p class="text-xs text-50 mt-1">
								新建时按标题自动建议（中文转拼音，与 pnpm new-post 规则一致），可随时手改。{#if sha}改动文件名将另存为新文件，原文件保留。{/if}
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

				<!-- 窄屏 tab 切换 / ≥md 双栏并排 -->
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
				<div class="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
					<div
						class="card-base px-4 py-4 w-full {mobileTab === "edit" ? "" : "hidden"} md:block!"
					>
						<textarea
							bind:this={bodyTextarea}
							bind:value={body}
							spellcheck="false"
							class="w-full min-h-[60vh] bg-transparent outline-hidden border-0 resize-y font-mono text-sm leading-7 text-75 placeholder:opacity-50"
							placeholder="在这里书写正文（Markdown）……"
						></textarea>
					</div>
					<div
						class="card-base px-6 md:px-9 pt-6 pb-4 w-full {mobileTab ===
						"preview"
							? ""
							: "hidden"} md:block!"
					>
						{#if preview.error}
							<p class="text-sm text-(--primary)">预览渲染出错：{preview.error}</p>
						{:else}
							<!-- 站点同款排版（markdown.css / markdown-extend.styl 由 write.astro 引入） -->
							<div class="prose dark:prose-invert prose-base max-w-none! custom-md">
								{@html preview.html}
							</div>
						{/if}
					</div>
				</div>
			{/if}
		</div>
	{/if}

	<!-- toast -->
	{#if notice}
		<div
			class="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 card-base px-5 py-3 text-sm text-75 shadow-lg"
		>
			{notice}
		</div>
	{/if}
</div>
