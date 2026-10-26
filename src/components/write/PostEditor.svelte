<script lang="ts">
/**
 * 文章页原位编辑器：挂在 #post-container 首位；待机按钮 portal 进元信息行右端
 * （#post-edit-slot，token 验证通过才显示）。点开 → 行内验证 token →
 * 进入编辑态时隐藏文章卡片其余部分与 #post-extras。
 * 「暂存草稿」写 write-drafts 分支（[CI Skip]，零构建零上线），「发布」提交
 * master 触发 Cloudflare Pages 构建；插图随暂存走草稿分支，发布时统一搬运。
 * 远端 404（本地预览文章尚未提交过）→ 以当前标题起草；该路径若有云端草稿则
 * 直接载入草稿内容，发布即新建。
 */
import { marked } from "marked";
import sanitizeHtml from "sanitize-html";
import { onDestroy, tick } from "svelte";
import {
	clearVerified,
	ensureVerified,
	markVerified,
	readVerifiedLogin,
	resolveToken,
} from "@/utils/write/auth";
import {
	DRAFT_BRANCH,
	deleteDraftFile,
	draftFileText,
	ensureDraftsBranch,
	fetchDraftFile,
	probeDraftAgainstMaster,
	publishPostFile,
	saveDraftImage,
	saveDraftPost,
} from "@/utils/write/drafts";
import {
	emptyFrontmatter,
	type PostFrontmatter,
	parsePostFile,
	serializePostFile,
} from "@/utils/write/frontmatter";
import {
	describeGitHubError,
	fetchCurrentUser,
	fetchFile,
	GitHubError,
	IMAGE_PUBLIC_PREFIX,
	POSTS_DIR,
} from "@/utils/write/github";
import { persistToken } from "@/utils/write/session";
import {
	fileNameToSlug,
	timestampPrefix,
	todayDateString,
} from "@/utils/write/slug";
import DateField from "./DateField.svelte";

let {
	fileName,
	initialTitle = "",
}: { fileName: string; initialTitle?: string } = $props();

type Mode = "idle" | "login" | "editing";

const inputClass =
	"w-full px-3 py-2 text-sm bg-transparent border border-black/10 dark:border-white/10 rounded-lg focus:ring-2 focus:ring-(--primary) focus:border-(--primary) hover:border-black/20 dark:hover:border-white/20 text-75 write-input transition-colors outline-hidden";

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
let mode = $state<Mode>("idle");
/** 编辑入口门控：token 验证通过才渲染「编辑」按钮（访客不可见） */
let authed = $state(false);
/** 待机按钮所在槽位是否为封面 overlay（决定按钮配色） */
let coverSlot = $state(false);
/** 待机按钮行：挂载后 portal 进 #post-edit-slot（元信息行右端） */
let idleRow = $state<HTMLElement | null>(null);
let token = $state("");
let userLogin = $state<string | null>(null);
let notice = $state("");
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
let rootEl = $state<HTMLDivElement | null>(null);

// --- 行内登录 ---
let tokenInput = $state("");
let loginBusy = $state(false);
let loginError = $state("");
/** 401 被踢出时保留编辑现场，登录卡提示文案切换 */
let reloginHint = $state("");

// --- 编辑器 ---
let editorReady = $state(false);
let editorLoading = $state(false);
let editorError = $state("");
let conflictPending = $state(false);
let fm = $state<PostFrontmatter>(emptyFrontmatter());
let body = $state("");
let extras = $state<Record<string, unknown>>({});
let sha = $state<string | null>(null);
/** 最近一次持久化（master 或草稿分支）的全文快照：驱动 dirty / beforeunload */
let savedSnapshot = $state("");
let tagsInput = $state("");
let seriesOrderInput = $state("");
/** 进编辑默认只露正文；标题/日期/标签等点「展开文章信息」再改 */
let showFrontmatter = $state(false);
let mobileTab = $state<"edit" | "preview">("edit");
let saving = $state(false);
let uploadingImage = $state(false);
let bodyTextarea = $state<HTMLTextAreaElement | null>(null);
let imageInput = $state<HTMLInputElement | null>(null);
/** 待机态预取远端正文：点「编辑」不必再等一次 Contents API（本机实测单次往返约 5s） */
let prefetchToken = "";
let prefetchPromise: Promise<{ text: string; sha: string } | null> | null =
	null;

// --- 云端草稿（write-drafts 分支）---
let draftSha = $state<string | null>(null);
let savingDraft = $state(false);
let loadingDraft = $state(false);
let discardingDraft = $state(false);
let draftBanner = $state<string | null>(null); // 非空 = 有未发布草稿，值为保存时间文案

const remotePath = `${POSTS_DIR}/${fileName}`;

/** 待机态预取远端正文；同 token 只跑一次，失败静默（点开时现场再拉） */
function primeRemote(tok: string) {
	if (!tok || mode !== "idle" || prefetchPromise) return;
	prefetchToken = tok;
	prefetchPromise = fetchFile(tok, remotePath).catch(() => null);
}
const isLoggedIn = $derived(userLogin !== null && token !== "");
const dirty = $derived(
	mode === "editing" &&
		editorReady &&
		serializePostFile(fm, extras, body) !== savedSnapshot,
);

const preview = $derived.by(() => {
	if (!editorReady) return { html: "", error: "" };
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

// --- 隐藏 / 恢复文章卡片其余部分 ---

// 编辑态一并收起的页面级元素：悬浮目录（指向已隐藏的正文标题）、移动端底部侧栏。
// updateSidebarComponentsVisibility 只在初始化/切页跑，不会中途冲掉这里的覆写
const EDITING_HIDDEN_IDS = ["floating-toc-wrapper", "mobile-bottom-sidebar"];
// 编辑态的列几何：与 computeGridColumns({enabled:false}) 的输出完全一致（单列铺满），
// 写在 #content-panel-inner（SSR 同名变量的宿主），退出时按备份恢复原值
const EDITING_GRID_VARS: Array<[string, string]> = [
	["--cols-md", "1fr"],
	["--cols-xl", "1fr"],
	["--left-display-md", "none"],
	["--left-display-xl", "none"],
	["--right-display-md", "none"],
	["--right-display-xl", "none"],
	["--content-ratio-md", "1"],
	["--content-ratio-xl", "1"],
];
const gridVarBackup = new Map<string, string>();

// 侧栏整列随编辑收起：data-sidebar-enable 翻 false，主题即使重算几何也得到同一组单列值
function setPageEditing(on: boolean) {
	const mainGrid = document.getElementById("main-grid");
	if (mainGrid) {
		if (on) {
			if (mainGrid.dataset.sidebarEnableBackup === undefined) {
				mainGrid.dataset.sidebarEnableBackup =
					mainGrid.getAttribute("data-sidebar-enable") ?? "";
				mainGrid.setAttribute("data-sidebar-enable", "false");
			}
		} else if (mainGrid.dataset.sidebarEnableBackup !== undefined) {
			mainGrid.setAttribute(
				"data-sidebar-enable",
				mainGrid.dataset.sidebarEnableBackup,
			);
			delete mainGrid.dataset.sidebarEnableBackup;
		}
	}
	const varHost = document.getElementById("content-panel-inner");
	if (varHost) {
		if (on) {
			for (const [key, value] of EDITING_GRID_VARS) {
				if (!gridVarBackup.has(key)) {
					gridVarBackup.set(key, varHost.style.getPropertyValue(key));
				}
				varHost.style.setProperty(key, value);
			}
		} else {
			for (const [key, original] of gridVarBackup) {
				if (original === "") varHost.style.removeProperty(key);
				else varHost.style.setProperty(key, original);
			}
			gridVarBackup.clear();
		}
	}
	for (const id of EDITING_HIDDEN_IDS) {
		const el = document.getElementById(id);
		if (!el) continue;
		if (on) el.style.setProperty("display", "none", "important");
		else el.style.removeProperty("display");
	}
}

function setSiblingsHidden(hidden: boolean) {
	const host = rootEl?.closest("#post-container");
	const island = rootEl?.closest("astro-island") ?? rootEl;
	if (!host || !island) return;
	for (const child of Array.from(host.children)) {
		if (child === island) continue;
		(child as HTMLElement).style.display = hidden ? "none" : "";
	}
	const extrasEl = document.getElementById("post-extras");
	if (extrasEl) extrasEl.style.display = hidden ? "none" : "";
	setPageEditing(hidden);
}

onDestroy(() => {
	setSiblingsHidden(false);
});

// 编辑态隐藏文章卡片其余部分与附加区，退出时恢复
$effect(() => {
	setSiblingsHidden(mode === "editing");
	return () => setSiblingsHidden(false);
});

// 未保存就关页面：给浏览器原生提示
$effect(() => {
	if (!dirty) return;
	const handler = (event: BeforeUnloadEvent) => {
		event.preventDefault();
	};
	window.addEventListener("beforeunload", handler);
	return () => window.removeEventListener("beforeunload", handler);
});

// 入口门控：token（自身或 /admin 复用）经 GET /user 静默验证后才显示「编辑」
$effect(() => {
	const saved = resolveToken();
	// 认证缓存命中（6h 内、token 未变）→ 跳过 GET /user，直接摆出入口并预取正文
	const cachedLogin = readVerifiedLogin(saved);
	if (cachedLogin) {
		token = saved;
		userLogin = cachedLogin;
		authed = true;
		primeRemote(saved);
		return;
	}
	void ensureVerified(saved).then((ok) => {
		authed = ok;
		if (!ok) return;
		userLogin = readVerifiedLogin(saved);
		primeRemote(saved);
	});
});

// 待机按钮 portal：进元信息行右端槽位（[...slug].astro 渲染），避免独占一行；
// 无槽位的页面形态（overlay 开启但无封面图等）保持卡片顶部原位兜底
$effect(() => {
	if (mode !== "idle" || !authed || !idleRow) return;
	const slot = document.getElementById("post-edit-slot");
	if (!slot) return;
	coverSlot = slot.dataset.variant === "cover";
	if (idleRow.parentElement !== slot) slot.appendChild(idleRow);
});

// --- 进入编辑 ---

function beginEdit() {
	loginError = "";
	reloginHint = "";
	const saved = resolveToken();
	if (!saved) {
		mode = "login";
		return;
	}
	token = saved;
	// 先切进编辑态（加载占位立刻出现，点击不再像没反应），网络排在后面
	primeRemote(saved);
	mode = "editing";
	void verifyAndLoad(saved);
}

async function verifyAndLoad(value: string) {
	loginBusy = true;
	loginError = "";
	// 缓存里的登录名可信（与入口门控同一份 6h 记录）：不再打 GET /user，
	// 401 由 loadRemote 兜底（kickToRelogin → 登录卡）
	const cachedLogin = userLogin ?? readVerifiedLogin(value);
	if (cachedLogin) {
		token = value;
		persistToken(value);
		userLogin = cachedLogin;
		loginBusy = false;
		if (editorReady) {
			// 401 后重新验证：编辑现场原样恢复，不再拉远端覆盖
			mode = "editing";
			return;
		}
		await loadRemote();
		return;
	}
	try {
		const user = await fetchCurrentUser(value);
		token = value;
		persistToken(value);
		userLogin = user.login;
		markVerified(value, user.login);
		tokenInput = "";
		if (editorReady) {
			// 401 后重新验证：编辑现场原样恢复，不再拉远端覆盖
			mode = "editing";
			return;
		}
		mode = "editing";
		await loadRemote();
	} catch (error) {
		token = "";
		persistToken("");
		userLogin = null;
		loginError = describeGitHubError(error);
		if (!editorReady) mode = "login";
	} finally {
		loginBusy = false;
	}
}

async function loadRemote() {
	editorLoading = true;
	editorError = "";
	try {
		const primed =
			prefetchPromise && prefetchToken === token ? prefetchPromise : null;
		prefetchPromise = null;
		// 预取失败（待机期间断网 / 404）→ 现场再拉一次，偶发失败不直接进错误态
		const file = (await primed) ?? (await fetchFile(token, remotePath));
		const parsed = parsePostFile(file.text);
		fm = parsed.frontmatter;
		body = parsed.body;
		extras = parsed.extras;
		sha = file.sha;
		applyDraftDefaults();
		showToast("已载入远端最新内容");
		// 草稿探测失败静默（probe 内部吞错），不阻塞主编辑流程
		void probeDraft(file.text);
	} catch (error) {
		if (error instanceof GitHubError && error.kind === "not-found") {
			// 本地预览有、远端没有：优先续写云端草稿，其次以当前标题起草
			try {
				const draft = await fetchDraftFile(token, remotePath);
				if (draft) {
					const parsed = parsePostFile(draftFileText(draft));
					fm = parsed.frontmatter;
					body = parsed.body;
					extras = parsed.extras;
					sha = null;
					draftSha = draft.sha;
					applyDraftDefaults();
					showToast("远端还没有这篇文章，已载入云端草稿，发布即新建");
					return;
				}
			} catch {
				/* 草稿读取失败 → 走空白起草 */
			}
			fm = emptyFrontmatter(true);
			fm.published = todayDateString();
			fm.title = initialTitle;
			body = "";
			extras = {};
			sha = null;
			applyDraftDefaults();
			showToast("远端还没有这篇文章，保存即新建");
		} else {
			editorError = describeGitHubError(error);
			if (error instanceof GitHubError && error.kind === "unauthorized") {
				kickToRelogin();
				// 缓存验证被远端否定：还没进过编辑现场就直接回登录卡，别停在空壳上
				if (!editorReady) mode = "login";
			}
		}
	} finally {
		editorReady = true;
		editorLoading = false;
	}
}

/** 打开文章后的草稿探测：草稿分支有更新且不同的内容 → 横幅提示 */
async function probeDraft(masterText: string) {
	const probe = await probeDraftAgainstMaster(token, remotePath, masterText);
	if (!probe) return;
	draftSha = probe.sha;
	draftBanner = probe.banner || null;
}

/** 载入云端草稿到编辑器（master sha 保留：发布时覆盖已发布版本） */
async function loadDraftVersion() {
	if (loadingDraft) return;
	loadingDraft = true;
	editorError = "";
	try {
		const file = await fetchDraftFile(token, remotePath);
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
		applyDraftDefaults();
		showToast("已载入云端草稿，点「发布」才会更新线上");
	} catch (error) {
		editorError = describeGitHubError(error);
	} finally {
		loadingDraft = false;
	}
}

/** 丢弃云端草稿（只删草稿分支文件，编辑器内容与已发布版本都不动） */
async function discardDraft() {
	if (discardingDraft) return;
	if (
		!window.confirm(
			"确认丢弃这篇的云端草稿？编辑器内容与已发布版本都不受影响。",
		)
	) {
		return;
	}
	discardingDraft = true;
	editorError = "";
	try {
		await deleteDraftFile(token, remotePath);
		draftSha = null;
		draftBanner = null;
		showToast("云端草稿已丢弃");
	} catch (error) {
		editorError = describeGitHubError(error);
	} finally {
		discardingDraft = false;
	}
}

/** 暂存草稿：写 write-drafts 分支（[CI Skip]），master 不动、线上零构建 */
async function saveDraft() {
	editorError = "";
	if (!isLoggedIn) {
		editorError = "登录已失效：请重新验证后再暂存（编辑内容已保留）";
		return;
	}
	if (savingDraft) return;
	savingDraft = true;
	try {
		syncMetaInputs();
		await ensureDraftsBranch(token);
		const result = await saveDraftPost(
			token,
			remotePath,
			serializePostFile(fm, extras, body),
			fm.title.trim() || fileName,
		);
		draftSha = result.sha;
		draftBanner = null;
		savedSnapshot = serializePostFile(fm, extras, body);
		showToast(`草稿已暂存到 ${DRAFT_BRANCH} 分支，线上不受影响`);
	} catch (error) {
		editorError = describeGitHubError(error);
		if (error instanceof GitHubError && error.kind === "unauthorized") {
			kickToRelogin();
		}
	} finally {
		savingDraft = false;
	}
}

function applyDraftDefaults() {
	tagsInput = fm.tags.join(", ");
	seriesOrderInput = fm.seriesOrder == null ? "" : String(fm.seriesOrder);
	savedSnapshot = serializePostFile(fm, extras, body);
}

function setUpdatedNow() {
	fm.updated = todayDateString();
}

function exitEdit() {
	if (dirty && !window.confirm("有未保存的修改，确定退出编辑吗？")) return;
	setSiblingsHidden(false);
	editorError = "";
	mode = "idle";
}

/** 401：清 token 但保留编辑内容，提示重新验证 */
function kickToRelogin() {
	token = "";
	persistToken("");
	clearVerified();
	userLogin = null;
	reloginHint = "登录已失效，编辑内容已保留";
	showToast("登录已失效，编辑内容已保留");
}

// --- 保存 ---

function validateForSave(): string {
	if (!fm.title.trim()) return "标题（title）不能为空";
	if (!fm.published) return "发布日期（published）不能为空";
	return "";
}

/** 把 tagsInput / seriesOrderInput / slug 兜底同步进 frontmatter（暂存与发布共用） */
function syncMetaInputs() {
	fm.tags = tagsInput
		.split(/[,，]/)
		.map((tag) => tag.trim())
		.filter(Boolean);
	fm.seriesOrder =
		seriesOrderInput.trim() === "" ? null : Number(seriesOrderInput);
	if (!fm.slug) {
		// slug 不带日期前缀（与 /write 的口径一致）
		const fallback = fileNameToSlug(fileName.replace(/\.(md|mdx)$/i, ""))
			.replace(/^\d{4}-\d{2}-\d{2}-/, "")
			.replace(/\/[^/]*$/, "");
		if (fallback) fm.slug = fallback;
	}
}

/** 发布：插图先搬 master，再提交正文，最后清理草稿（收尾失败进 warnings） */
async function save() {
	editorError = "";
	conflictPending = false;
	if (!isLoggedIn) {
		editorError = "登录已失效：请重新验证后再发布（编辑内容已保留）";
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
		const { sha: newSha, warnings } = await publishPostFile(
			token,
			remotePath,
			serializePostFile(fm, extras, body),
			fm.title.trim(),
			sha ?? undefined,
		);
		sha = newSha;
		draftSha = null;
		draftBanner = null;
		savedSnapshot = serializePostFile(fm, extras, body);
		showToast(
			warnings.length
				? `已发布；${warnings.length} 项草稿收尾未完成：${warnings[0]}`
				: "已发布，Cloudflare 构建约 1-2 分钟后此页面才会更新为新内容",
		);
	} catch (error) {
		editorError = describeGitHubError(error);
		if (error instanceof GitHubError && error.kind === "conflict") {
			conflictPending = true;
		} else if (error instanceof GitHubError && error.kind === "unauthorized") {
			kickToRelogin();
		}
	} finally {
		saving = false;
	}
}

/** 409 冲突：重拉远端最新内容，覆盖本地编辑 */
async function reloadRemote() {
	editorError = "";
	conflictPending = false;
	editorLoading = true;
	try {
		const file = await fetchFile(token, remotePath);
		const parsed = parsePostFile(file.text);
		fm = parsed.frontmatter;
		body = parsed.body;
		extras = parsed.extras;
		sha = file.sha;
		applyDraftDefaults();
		showToast("已重载远端最新内容，请基于它修改后再保存");
	} catch (error) {
		editorError = describeGitHubError(error);
	} finally {
		editorLoading = false;
	}
}

// --- 插图 ---

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
		editorError = "登录已失效：请重新验证后再上传图片";
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
		// 插图随暂存走草稿分支：写作中途传图不触发 master 构建，发布时统一搬运
		await ensureDraftsBranch(token);
		await saveDraftImage(token, uploadName, base64);
		const alt = file.name.replace(/[[\]]/g, "");
		await insertAtCursor(
			`![${alt}](${IMAGE_PUBLIC_PREFIX}/${encodeURI(uploadName)})`,
		);
		showToast("图片已暂存到草稿分支并插入正文（发布时随文章一起上线）");
	} catch (error) {
		editorError = describeGitHubError(error);
		if (error instanceof GitHubError && error.kind === "unauthorized") {
			kickToRelogin();
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

<div class="w-full" bind:this={rootEl}>
	{#if mode === "idle" && authed}
		<!-- 待机：portal 进元信息行右端（无槽位时退回卡片顶部），认证后才可见 -->
		<div bind:this={idleRow} class="relative z-10 inline-flex">
			<button
				type="button"
				class={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg transition-colors ${coverSlot ? "text-white/90 hover:text-white" : "text-50 hover:text-(--primary) hover:bg-black/5 dark:hover:bg-white/10"}`}
				onclick={beginEdit}
				title="用 GitHub token 原位编辑这篇文章"
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
					aria-hidden="true"
				>
					<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"></path>
				</svg>
				<span>编辑</span>
			</button>
		</div>
	{:else if mode === "login"}
		<!-- 行内迷你登录卡（含 401 后重登，编辑现场保留在内存里） -->
		<div class="rounded-lg border border-black/10 dark:border-white/10 bg-(--btn-regular-bg) px-4 py-4 my-2 w-full max-w-xl">
			<div class="text-sm font-medium text-90 mb-3">
				{reloginHint || "验证 GitHub token 后开始编辑"}
			</div>
			<input
				type="password"
				class={inputClass}
				placeholder="ghp_… / github_pat_…"
				bind:value={tokenInput}
				onkeydown={(event) => {
					if (event.key === "Enter") void verifyAndLoad(tokenInput.trim());
				}}
			>
			{#if loginError}
				<p class="text-xs text-(--primary) mt-2 leading-relaxed">{loginError}</p>
			{/if}
			<div class="flex flex-wrap gap-3 mt-4">
				<button
					type="button"
					class="btn-regular rounded-(--radius-large) px-5 h-9 text-xs"
					onclick={() => void verifyAndLoad(tokenInput.trim())}
					disabled={loginBusy || tokenInput.trim() === ""}
				>
					{loginBusy ? "验证中……" : "验证并进入编辑"}
				</button>
				<button
					type="button"
					class="btn-plain rounded-(--radius-large) px-5 h-9 text-xs"
					onclick={() => {
						if (editorReady) {
							mode = "editing";
						} else {
							mode = "idle";
						}
						loginError = "";
						reloginHint = "";
					}}
				>
					{editorReady ? "返回编辑" : "取消"}
				</button>
			</div>
			<p class="text-xs text-50 mt-4 leading-relaxed">
				Token 仅保存在本浏览器 localStorage，只发送给 GitHub API。
			</p>
		</div>
	{:else if mode === "editing"}
		<!-- 编辑态：占据整张卡片（其余兄弟节点已被隐藏）。
			注意必须显式判定 editing：访客待机态（idle && !authed）三个分支都不命中、
			渲染为空——若用 {:else} 兜底，SSR 与水合都会给访客渲染出整个编辑面板 -->
		<div class="w-full pb-2">
			<!-- 工具条 -->
			<div class="flex flex-wrap items-center gap-3 mb-4">
				<button
					type="button"
					class="btn-plain rounded-(--radius-large) px-4 h-9 text-xs"
					onclick={exitEdit}
				>
					← 退出编辑
				</button>
				{#if editorReady}
					<button
						type="button"
						class="btn-plain rounded-(--radius-large) px-4 h-9 text-xs"
						onclick={() => (showFrontmatter = !showFrontmatter)}
						aria-expanded={showFrontmatter}
					>
						{showFrontmatter ? "收起文章信息" : "展开文章信息"}
					</button>
				{/if}
				<span class="flex-1"></span>
				<!-- 载入完成前不显示远端状态与动作：sha 还没拿到，徽标会闪出「远端还没有 / 重新验证」 -->
				{#if editorReady}
					<span
						class="text-xs px-2.5 py-1 rounded-full border border-black/10 dark:border-white/15 text-50 font-mono"
					>
						{fileName}
					</span>
					<span
						class="text-xs px-2.5 py-1 rounded-full border border-black/10 dark:border-white/15 text-50"
					>
						{sha ? "已同步远端" : "远端还没有，发布即新建"}
					</span>
					{#if draftSha}
						<span
							class="text-xs px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400"
						>
							有云端草稿
						</span>
					{/if}
					{#if !isLoggedIn}
						<button
							type="button"
							class="text-xs px-2.5 py-1 rounded-full border border-(--primary)/40 text-(--primary) hover:bg-(--primary)/10 transition-colors"
							onclick={() => {
								reloginHint = "登录已失效，编辑内容已保留";
								mode = "login";
							}}
						>
							重新验证
						</button>
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
						title={isLoggedIn ? "" : "重新验证后才能上传图片"}
					>
						{uploadingImage ? "上传中……" : "插入图片"}
					</button>
					<button
						type="button"
						class="btn-plain rounded-(--radius-large) px-4 h-9 text-xs"
						onclick={() => void saveDraft()}
						disabled={!isLoggedIn || savingDraft}
						title={isLoggedIn
							? `暂存到 ${DRAFT_BRANCH} 分支，不影响线上`
							: "重新验证后才能暂存"}
					>
						{savingDraft ? "暂存中……" : "暂存草稿"}
					</button>
					<button
						type="button"
						class="btn-regular rounded-(--radius-large) px-6 h-9 text-sm"
						onclick={() => void save()}
						disabled={!isLoggedIn || saving}
						title={isLoggedIn
							? "提交到 master 分支并触发 Cloudflare 构建（约 1-2 分钟上线）"
							: "重新验证后才能发布"}
					>
						{saving ? "发布中……" : "发布"}
					</button>
				{/if}
			</div>

			{#if draftBanner && !editorLoading && !editorError}
				<div
					class="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-75 flex flex-wrap items-center gap-3"
				>
					<span class="flex-1 min-w-0 leading-relaxed">
						这篇有未发布的云端草稿（保存于 {draftBanner}），内容与当前版本不同。可继续编辑当前内容，或载入草稿。
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
					class="mb-4 rounded-lg border border-(--primary)/30 bg-(--primary)/5 px-4 py-3 text-sm text-75 flex flex-wrap items-center gap-3"
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

			<!-- /user 等待期（!editorReady）也算加载中：绝不能先渲染出空白编辑器 -->
			{#if editorLoading || !editorReady}
				<div class="py-6" aria-busy="true" aria-live="polite">
					<div
						class="min-h-[60vh] rounded-(--radius-large) border border-black/5 dark:border-white/10 bg-black/[.015] dark:bg-white/[.02] flex flex-col items-center justify-center gap-3"
					>
						<!-- spinner 与 DynamicSidebar 同款，保持全站一致 -->
						<svg
							class="size-5 animate-spin text-(--primary)"
							viewBox="0 0 24 24"
							fill="none"
						>
							<circle
								cx="12"
								cy="12"
								r="10"
								stroke="currentColor"
								stroke-width="3"
								opacity="0.25"
							/>
							<path
								d="M4 12a8 8 0 018-8"
								stroke="currentColor"
								stroke-width="3"
								stroke-linecap="round"
							/>
						</svg>
						<p class="m-0 text-xs text-75">正在载入远端内容……</p>
					</div>
				</div>
			{:else}
				<!-- frontmatter 折叠表单 -->
				{#if showFrontmatter}
					<div class="write-surface grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 pb-5 mb-5 border-b border-black/5 dark:border-white/10">
						<div class="md:col-span-2">
							<label class={labelClass} for="pe-title">标题（title） *</label>
							<input
								id="pe-title"
								type="text"
								class={inputClass}
								placeholder="文章标题"
								bind:value={fm.title}
							>
						</div>
						<div>
							<label class={labelClass} for="pe-published">发布日期（published） *</label>
							<DateField id="pe-published" inputClass={inputClass} bind:value={fm.published} />
						</div>
						<div>
							<label class={labelClass} for="pe-updated">更新日期（updated）</label>
							<div class="flex gap-2">
								<DateField id="pe-updated" inputClass={inputClass} bind:value={fm.updated} />
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
							<label class={labelClass} for="pe-description">摘要（description）</label>
							<input
								id="pe-description"
								type="text"
								class={inputClass}
								placeholder="用于列表与 meta 的简短描述"
								bind:value={fm.description}
							>
						</div>
						<div class="md:col-span-2">
							<label class={labelClass} for="pe-image">封面图（image）</label>
							<input
								id="pe-image"
								type="text"
								class={inputClass}
								placeholder="/assets/images/posts/… 或完整 URL"
								bind:value={fm.image}
							>
						</div>
						<div>
							<label class={labelClass} for="pe-tags">标签（tags，逗号分隔）</label>
							<input
								id="pe-tags"
								type="text"
								class={inputClass}
								placeholder="随笔, 技术"
								bind:value={tagsInput}
							>
						</div>
						<div>
							<label class={labelClass} for="pe-category">分类（category）</label>
							<input
								id="pe-category"
								type="text"
								class={inputClass}
								placeholder="如：日常"
								bind:value={fm.category}
							>
						</div>
						<div>
							<label class={labelClass} for="pe-author">作者（author）</label>
							<input
								id="pe-author"
								type="text"
								class={inputClass}
								placeholder="留空使用站点默认"
								bind:value={fm.author}
							>
						</div>
						<div>
							<label class={labelClass} for="pe-series">系列（series）</label>
							<input
								id="pe-series"
								type="text"
								class={inputClass}
								placeholder="系列名，非系列文章留空"
								bind:value={fm.series}
							>
						</div>
						<div>
							<label class={labelClass} for="pe-series-order">系列序号（seriesOrder，可空）</label>
							<input
								id="pe-series-order"
								type="number"
								class={inputClass}
								placeholder="如 1"
								bind:value={seriesOrderInput}
							>
						</div>
						<div>
							<label class={labelClass} for="pe-slug">slug（URL 标识，留空自动生成）</label>
							<input
								id="pe-slug"
								type="text"
								class={inputClass}
								placeholder="留空按文件名自动生成"
								bind:value={fm.slug}
							>
						</div>
						<div class="flex items-center gap-6 pt-1 md:col-span-2">
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
						class="rounded-(--radius-large) bg-black/[.015] dark:bg-white/[.02] border border-black/5 dark:border-white/10 px-4 py-4 w-full {mobileTab ===
						"edit"
							? ""
							: "hidden"} md:block!"
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
						class="rounded-(--radius-large) bg-black/[.015] dark:bg-white/[.02] border border-black/5 dark:border-white/10 px-6 md:px-9 pt-6 pb-4 w-full {mobileTab ===
						"preview"
							? ""
							: "hidden"} md:block!"
					>
						{#if preview.error}
							<p class="text-sm text-(--primary)">预览渲染出错：{preview.error}</p>
						{:else}
							<!-- 站点同款排版（markdown 样式随主题全局加载，文章页可用） -->
							<div class="prose dark:prose-invert prose-base max-w-none! custom-md">
								{@html preview.html}
							</div>
						{/if}
					</div>
				</div>
			{/if}
		</div>
	{/if}
</div>

<!-- toast -->
{#if notice}
	<div
		class="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 card-base px-5 py-3 text-sm text-75 shadow-lg"
	>
		{notice}
	</div>
{/if}
