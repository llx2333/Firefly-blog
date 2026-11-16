<script lang="ts">
/**
 * 「配置」弹层（批31 lua 配置系统，自包含；接线归集成阶段）：
 * 左 = write-drafts 分支 lua/ 文件树（新建/删除，init.lua 系统自带无删除入口），
 * 右 = CM6 lua 编辑（@codemirror/legacy-modes StreamLanguage 高亮）+ 保存 +
 * 重载配置（拉取→wasmoon 执行→应用到主编辑器，热生效）。
 * 兜底：执行失败只给错误徽标/提示，主编辑器照常可用。
 *
 * 接线（集成阶段）：
 *   let configOpen = $state(false);
 *   <button onclick={() => (configOpen = true)}>配置</button>
 *   <ConfigDialog bind:open={configOpen} {token} editorHandle={cmHandle} onClose={() => (configOpen = false)} />
 *   编辑器 onMount 建好后调 reloadLuaConfig(token, cmHandle) 完成初始化加载。
 */
import { onMount, tick } from "svelte";
import type { CmEditorHandle } from "@/utils/write/cm-editor";
import {
	deleteDraftFile,
	draftFileText,
	fetchDraftFile,
	listDraftTree,
	saveDraftFile,
} from "@/utils/write/drafts";
import {
	ensureInitLua,
	getLuaStatus,
	INIT_LUA_PATH,
	LUA_DIR,
	type LuaStatus,
	reloadLuaConfig,
	subscribeLuaStatus,
} from "@/utils/write/editor-config";
import { describeGitHubError } from "@/utils/write/github";

let {
	open = false,
	token = "",
	editorHandle = null,
	onClose,
}: {
	open?: boolean;
	token?: string;
	editorHandle?: CmEditorHandle | null;
	onClose: () => void;
} = $props();

let dialogHost = $state<HTMLDivElement | null>(null);
// 弹层内嵌 CM6 实例（@codemirror/view 的 EditorView；依赖动态 import，SSR 安全）
let dialogCm: import("@codemirror/view").EditorView | null = null;

let luaFiles = $state<string[]>([]);
let activePath = $state<string | null>(null);
let dirty = $state(false);
let busy = $state(false);
let loading = $state(false);
let fileError = $state("");
let flash = $state("");
let luaStatus = $state<LuaStatus>(getLuaStatus());
let newFileMode = $state(false);
let newFilePath = $state("");
let newFileInput = $state<HTMLInputElement | null>(null);

const textCache = new Map<string, string>();

onMount(() => {
	return subscribeLuaStatus((status) => {
		luaStatus = status;
	});
});

$effect(() => {
	if (newFileMode) {
		void tick().then(() => newFileInput?.focus());
	}
});

// 开启 → 建弹层编辑器 + 拉文件树；关闭 → 销毁（宿主随 {#if} 卸载）
$effect(() => {
	if (!open) return;
	let disposed = false;
	// 每次开启都是干净的操作反馈（组件实例随关闭保留，旧 flash/error 不带回来）
	flash = "";
	fileError = "";
	void tick().then(async () => {
		if (disposed) return;
		await ensureDialogEditor();
		if (disposed) return;
		void loadAll(true);
	});
	return () => {
		disposed = true;
		if (dialogCm) {
			dialogCm.destroy();
			dialogCm = null;
		}
	};
});

async function ensureDialogEditor(): Promise<void> {
	if (dialogCm || !dialogHost) return;
	const [
		{ EditorView, keymap },
		{ EditorState },
		{ defaultKeymap, history, historyKeymap },
		{ StreamLanguage },
		{ lua },
	] = await Promise.all([
		import("@codemirror/view"),
		import("@codemirror/state"),
		import("@codemirror/commands"),
		import("@codemirror/language"),
		import("@codemirror/legacy-modes/mode/lua"),
	]);
	dialogCm = new EditorView({
		parent: dialogHost,
		state: EditorState.create({
			doc: "",
			extensions: [
				StreamLanguage.define(lua),
				EditorState.tabSize.of(4),
				EditorView.lineWrapping,
				history(),
				keymap.of([...defaultKeymap, ...historyKeymap]),
				EditorView.updateListener.of((update) => {
					if (update.docChanged) dirty = true;
				}),
				EditorView.theme({
					"&": {
						height: "100%",
						backgroundColor: "transparent",
						fontSize: "inherit",
						color: "inherit",
					},
					"&.cm-focused": { outline: "none" },
					".cm-scroller": {
						overflow: "auto",
						fontFamily: "inherit",
						lineHeight: "1.6rem",
					},
					".cm-content": {
						padding: "8px 0",
						caretColor: "var(--primary, currentColor)",
					},
					".cm-cursor": { borderLeftColor: "var(--primary, currentColor)" },
					// 选区色走站点 token 并反压 CM 内置 focused 默认色（同 cm-editor.ts 注释）
					".cm-selectionBackground": {
						backgroundColor: "var(--selection-bg)",
					},
					"&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground":
						{
							backgroundColor: "var(--selection-bg)",
						},
				}),
			],
		}),
	});
}

function sortedPaths(entries: { path: string; name: string }[]): string[] {
	return entries
		.map((entry) => entry.path)
		.sort((a, b) => {
			// init.lua 置顶，其余按路径字典序
			if (a === INIT_LUA_PATH) return -1;
			if (b === INIT_LUA_PATH) return 1;
			return a.localeCompare(b);
		});
}

/** 打开/重建文件树；ensure = 首次打开时补建 init.lua（需登录态） */
async function loadAll(ensure: boolean): Promise<void> {
	loading = true;
	fileError = "";
	try {
		if (ensure && token) {
			await ensureInitLua(token);
		}
		const entries = await listDraftTree(token, LUA_DIR);
		luaFiles = sortedPaths(entries.filter((e) => /\.lua$/i.test(e.name)));
		if (!activePath || !luaFiles.includes(activePath)) {
			activePath = luaFiles.includes(INIT_LUA_PATH)
				? INIT_LUA_PATH
				: (luaFiles[0] ?? null);
		}
		if (activePath) await loadFile(activePath);
		else
			dialogCm?.dispatch({
				changes: { from: 0, to: dialogCm.state.doc.length, insert: "" },
			});
	} catch (error) {
		fileError = describeGitHubError(error);
	} finally {
		loading = false;
	}
}

async function loadFile(path: string): Promise<void> {
	fileError = "";
	try {
		let text = textCache.get(path);
		if (text === undefined) {
			const file = await fetchDraftFile(token, path);
			text = file ? draftFileText(file) : "";
			textCache.set(path, text);
		}
		if (dialogCm) {
			dialogCm.dispatch({
				changes: { from: 0, to: dialogCm.state.doc.length, insert: text },
			});
			dirty = false;
		}
	} catch (error) {
		fileError = describeGitHubError(error);
	}
}

async function selectFile(path: string): Promise<void> {
	if (path === activePath) return;
	flash = "";
	activePath = path;
	await loadFile(path);
}

/** 保存当前文件（更新缓存 + 云端 PUT） */
async function saveActive(): Promise<void> {
	if (!activePath || !dialogCm || busy) return;
	if (!token) {
		fileError = "只读模式：登录后才能保存配置";
		return;
	}
	busy = true;
	fileError = "";
	try {
		const text = dialogCm.state.doc.toString();
		await saveDraftFile(
			token,
			activePath,
			text,
			`write(draft): 保存 lua 配置 ${activePath}`,
		);
		textCache.set(activePath, text);
		dirty = false;
		flash = "已保存";
	} catch (error) {
		fileError = describeGitHubError(error);
	} finally {
		busy = false;
	}
}

/** 重载配置：拉取 → wasmoon 执行 → 应用主编辑器（热生效） */
async function reloadConfig(): Promise<void> {
	if (busy) return;
	busy = true;
	fileError = "";
	flash = "";
	try {
		await reloadLuaConfig(token, editorHandle);
		// 结果（成功/失败与提示）经 subscribeLuaStatus 回流到 luaStatus 徽标
	} finally {
		busy = false;
	}
}

/** init.lua 系统自带，无删除入口 */
function isProtected(path: string): boolean {
	return path === INIT_LUA_PATH;
}

async function deleteFile(path: string): Promise<void> {
	if (isProtected(path) || busy) return;
	if (!token) {
		fileError = "只读模式：登录后才能删除配置";
		return;
	}
	if (!window.confirm(`确定删除 ${path} 吗？`)) return;
	busy = true;
	fileError = "";
	try {
		await deleteDraftFile(token, path);
		textCache.delete(path);
		flash = "已删除";
		await loadAll(false);
	} catch (error) {
		fileError = describeGitHubError(error);
	} finally {
		busy = false;
	}
}

/**
 * 新建路径归一化：接受 `keymaps/x.lua`、`lua/keymaps/x.lua` 等相对写法；
 * 目录随文件隐式创建。非法（空段 / ..）返回 null。
 */
function normalizeNewPath(raw: string): string | null {
	let p = raw.trim().replace(/\\/g, "/").replace(/^\/+/, "");
	if (
		p.toLowerCase() === LUA_DIR ||
		p.toLowerCase().startsWith(`${LUA_DIR}/`)
	) {
		p = p.slice(LUA_DIR.length + 1);
	}
	if (!p) return null;
	if (!/\.lua$/i.test(p)) p += ".lua";
	const segs = p.split("/");
	if (segs.some((seg) => !seg || seg === "." || seg === "..")) return null;
	return `${LUA_DIR}/${segs.join("/")}`;
}

async function createFile(): Promise<void> {
	if (!token) {
		fileError = "只读模式：登录后才能新建配置";
		return;
	}
	const path = normalizeNewPath(newFilePath);
	if (!path) {
		fileError = "路径非法：请写相对路径（如 keymaps/x.lua），目录自动创建";
		return;
	}
	busy = true;
	fileError = "";
	try {
		if (!luaFiles.includes(path)) {
			await saveDraftFile(
				token,
				path,
				`-- ${path}\n\n`,
				`write(draft): 新建 lua 配置 ${path}`,
			);
			flash = "已创建";
		} else {
			flash = "文件已存在，直接打开";
		}
		newFileMode = false;
		newFilePath = "";
		await loadAll(false);
		activePath = path;
		await loadFile(path);
	} catch (error) {
		fileError = describeGitHubError(error);
	} finally {
		busy = false;
	}
}

function startNewFile(): void {
	newFileMode = true;
	newFilePath = "";
}

/** 恢复当前文件为上次保存内容（误改时的轻量撤销） */
async function revertActive(): Promise<void> {
	if (!activePath) return;
	flash = "";
	textCache.delete(activePath);
	await loadFile(activePath);
}

/** 文件树缩进层级（目录隐式，仅用于视觉） */
function depthOf(path: string): number {
	return Math.max(0, path.split("/").length - 2);
}

const statusDot: Record<LuaStatus["state"], string> = {
	idle: "bg-neutral-400/60",
	loading: "bg-amber-500/80",
	ok: "bg-emerald-600/80",
	error: "bg-red-600/80",
};
</script>

<svelte:window
	onkeydown={(event) => {
		if (event.key === "Escape" && open && !dialogCm?.hasFocus) onClose();
	}}
/>

{#if open}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 text-90"
		role="dialog"
		aria-modal="true"
		aria-label="编辑器 lua 配置"
	>
		<div
			class="bg-[color:var(--card-bg)] w-full max-w-4xl rounded-(--radius-large) p-5 flex flex-col"
			style="height: min(80vh, 720px)"
		>
			<!-- 头部：标题 + 配置状态徽标 -->
			<div class="flex items-center justify-between mb-3 shrink-0">
				<div class="flex items-center gap-2">
					<span class="text-sm font-medium text-90">编辑器 lua 配置</span>
					<span
						class="inline-block size-2 rounded-full {statusDot[luaStatus.state]}"
						title="{luaStatus.state}{luaStatus.message ? `：${luaStatus.message}` : ''}"
					></span>
					{#if luaStatus.message}
						<span class="text-xs text-50 truncate max-w-52" title={luaStatus.message}>
							{luaStatus.message}
						</span>
					{/if}
				</div>
				<button
					type="button"
					class="btn-plain rounded-(--radius-large) px-3 h-8 text-xs"
					onclick={onClose}
					aria-label="关闭配置弹层"
				>
					关闭
				</button>
			</div>

			<div class="flex gap-4 flex-1 min-h-0">
				<!-- 左：文件树 -->
				<div class="w-56 shrink-0 flex flex-col min-h-0 border border-black/10 dark:border-white/10 rounded-lg overflow-hidden">
					<div class="px-3 py-2 text-xs text-50 border-b border-black/10 dark:border-white/10 flex items-center justify-between shrink-0">
						<span class="font-mono">{LUA_DIR}/</span>
						<button
							type="button"
							class="text-xs hover:text-(--primary) transition-colors"
							onclick={startNewFile}
							title="新建配置文件（目录随路径自动创建）"
						>
							+ 新建
						</button>
					</div>
					{#if newFileMode}
						<div class="px-3 py-2 border-b border-black/10 dark:border-white/10 shrink-0">
							<input
								bind:this={newFileInput}
								bind:value={newFilePath}
								type="text"
								placeholder="keymaps/x.lua"
								class="w-full px-2 py-1.5 text-xs font-mono bg-transparent border border-black/10 dark:border-white/10 rounded-md focus:ring-2 focus:ring-(--primary) outline-hidden text-75"
								aria-label="新文件相对路径"
								onkeydown={(event) => {
									if (event.key === "Enter") {
										event.preventDefault();
										void createFile();
									} else if (event.key === "Escape") {
										event.preventDefault();
										// 只收起新建输入行，不让 Esc 冒泡到 window 关掉整个弹层
										event.stopPropagation();
										newFileMode = false;
									}
								}}
							/>
							<div class="flex gap-2 mt-2">
								<button
									type="button"
									class="btn-regular rounded-md px-3 h-7 text-xs flex-1"
									disabled={busy}
									onclick={() => void createFile()}
								>
									创建
								</button>
								<button
									type="button"
									class="btn-plain rounded-md px-3 h-7 text-xs"
									onclick={() => (newFileMode = false)}
								>
									取消
								</button>
							</div>
						</div>
					{/if}
					<div class="flex-1 overflow-y-auto px-1.5 py-1.5">
						{#if loading && luaFiles.length === 0}
							<div class="text-xs text-50 px-2 py-1.5">加载中……</div>
						{/if}
						{#each luaFiles as path (path)}
							<div
								class="group flex items-center gap-1 rounded-md px-1.5 py-1 {path === activePath
									? 'bg-black/5 dark:bg-white/10 text-90'
									: 'text-50 hover:bg-black/5 dark:hover:bg-white/10'} cursor-pointer transition-colors"
								style="padding-left: {0.375 + depthOf(path) * 0.75}rem"
							>
								<button
									type="button"
									class="flex-1 text-left text-xs font-mono truncate"
									title={path}
									onclick={() => void selectFile(path)}
								>
									{path === INIT_LUA_PATH ? `${path}（入口）` : path.split("/").pop()}
								</button>
								{#if !isProtected(path)}
									<button
										type="button"
										class="shrink-0 size-5 rounded text-xs text-50 opacity-0 group-hover:opacity-100 hover:text-red-500 transition-all"
										title="删除 {path}"
										aria-label="删除 {path}"
										onclick={() => void deleteFile(path)}
									>
										×
									</button>
								{/if}
							</div>
						{/each}
					</div>
					<div class="px-3 py-2 text-[11px] leading-relaxed text-50 border-t border-black/10 dark:border-white/10 shrink-0">
						init.lua 系统自带不可删；新文件允许子目录，require 路径为 <span class="font-mono">lua.模块名</span>。
					</div>
				</div>

				<!-- 右：编辑器 + 操作 -->
				<div class="flex-1 min-w-0 flex flex-col min-h-0">
					<div class="flex items-center gap-2 mb-2 shrink-0 flex-wrap">
						<span class="text-xs font-mono text-75 truncate flex-1" title={activePath ?? ""}>
							{activePath ?? "（lua 目录为空）"}{dirty ? " ●" : ""}
						</span>
						<button
							type="button"
							class="btn-plain rounded-(--radius-large) px-3 h-8 text-xs"
							disabled={busy || !activePath}
							onclick={() => void revertActive()}
							title="放弃未保存的修改，恢复为上次保存内容"
						>
							还原
						</button>
						<button
							type="button"
							class="btn-plain rounded-(--radius-large) px-3 h-8 text-xs"
							disabled={busy}
							onclick={() => void reloadConfig()}
							title="重新拉取并执行 lua 配置，热应用到编辑器"
						>
							重载配置
						</button>
						<button
							type="button"
							class="btn-regular rounded-(--radius-large) px-4 h-8 text-xs"
							disabled={busy || !activePath || !dirty}
							onclick={() => void saveActive()}
						>
							保存
						</button>
					</div>
					{#if fileError}
						<div class="text-xs text-red-500 mb-2 shrink-0" role="alert">{fileError}</div>
					{/if}
					{#if flash && !fileError}
						<div class="text-xs text-emerald-600 dark:text-emerald-400 mb-2 shrink-0">{flash}</div>
					{/if}
					<div class="flex-1 min-h-0 border border-black/10 dark:border-white/10 rounded-lg overflow-hidden font-mono text-xs" bind:this={dialogHost}>
					</div>
					<p class="text-[11px] text-50 mt-2 shrink-0 leading-relaxed">
						默认入口示例在 init.lua 注释里；保存后点「重载配置」立即生效，语法错误只会提示、不影响编辑器。
					</p>
				</div>
			</div>
		</div>
	</div>
{/if}
