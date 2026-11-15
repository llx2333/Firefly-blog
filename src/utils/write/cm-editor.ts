/**
 * CM6 编辑器统一装配（WriteEditor / PostEditor 共用，组件只绑定不装配）。
 *
 * 装配内容（批30 P5/P6/P7 + 批31 lua 配置）：
 * - markdown 语言（lang-markdown 内置 markdownKeymap：Enter 自动续行——列表补
 *   `- `、缩进行保持缩进、普通段落不加重缩进、围栏代码块续行）；
 * - indentation-markers：VSCode 式缩进竖线（颜色随站点明暗，见 write-surface.css
 *   的 --indent-marker-* 覆写）；lua 配置 indent_guides=false 可整体关闭；
 * - history + historyKeymap：Ctrl+Z / Ctrl+Y 撤销重做（替代原 textarea 的浏览器原生）；
 * - vim 扩展经 Compartment 热开关（ff.editor.vim，默认关；@replit/codemirror-vim
 *   需 drawSelection 渲染可视模式选区）；
 * - lua 配置（editor-config.ts）经 handle.applyLua 热应用：
 *   tab_size（Tab→空格 + 缩进单位）、wrap（自动换行开关）、indent_guides、
 *   ff.map 键位（单键直绑 + 多键序列缓冲；vim 开启时 normal 映射走 vim API）。
 *
 * SSR 纪律：全部 CM 运行时依赖走动态 import，只在客户端（onMount 后）执行——
 * client:load 岛屿在 SSR/构建期也会跑模块顶层，CM6 在 Node 下缺 DOM 会炸。
 * svelte-codemirror-editor 不采用：需要自定义 vim Compartment / scroller 暴露 /
 * 视觉对齐旧 textarea，直装 EditorView 控制力更完整（已 pnpm remove 该包）。
 */
import type { Extension } from "@codemirror/state";
import type { EditorView as CMEditorView, KeyBinding } from "@codemirror/view";
import type { CodeMirrorV } from "@replit/codemirror-vim";
import type { LuaMapping, ParsedKey } from "./editor-config";

export type EditorLayout = "edit" | "split" | "preview";

/** 编辑器布局偏好键（批30 新键一律 ff.editor.*，绝不触碰播放器键） */
const LAYOUT_KEY = "ff.editor.layout";
/** vim 模式偏好键 */
const VIM_KEY = "ff.editor.vim";

function isBrowser(): boolean {
	return typeof window !== "undefined";
}

/** 读布局偏好：缺省/坏值一律回退 split（默认双窗） */
export function readLayoutPref(): EditorLayout {
	if (!isBrowser()) return "split";
	try {
		const raw = window.localStorage.getItem(LAYOUT_KEY);
		return raw === "edit" || raw === "preview" ? raw : "split";
	} catch {
		return "split";
	}
}

export function writeLayoutPref(layout: EditorLayout): void {
	if (!isBrowser()) return;
	try {
		window.localStorage.setItem(LAYOUT_KEY, layout);
	} catch {
		/* 隐私模式等存不进就算了，本次会话内仍生效 */
	}
}

/** 读 vim 偏好：缺省/坏值一律 false（默认关） */
export function readVimPref(): boolean {
	if (!isBrowser()) return false;
	try {
		return window.localStorage.getItem(VIM_KEY) === "true";
	} catch {
		return false;
	}
}

export function writeVimPref(enabled: boolean): void {
	if (!isBrowser()) return;
	try {
		window.localStorage.setItem(VIM_KEY, enabled ? "true" : "false");
	} catch {
		/* 同上 */
	}
}

export interface CmEditorOptions {
	/** 创建时的初始全文 */
	value: string;
	placeholder?: string;
	/** doc 任意变化回调（组件写回 body，替代原 bind:value） */
	onDocChange: (value: string) => void;
	/** 初始是否开 vim（此后用 handle.setVim 热切换） */
	vimEnabled: boolean;
}

/** lua 配置的 CM 侧应用载荷（editor-config.applyLuaConfig 组装） */
export interface CmLuaSpec {
	/** 缩进宽度：Tab 实得 N 个空格 + 缩进单位跟随；缺省恢复站点默认 */
	tabSize?: number;
	/** 自动换行；undefined = 保持默认（开） */
	wrap?: boolean;
	/** 缩进竖线；undefined = 保持默认（开） */
	indentGuides?: boolean;
	/** lua 解析出的键位映射 */
	mappings?: LuaMapping[];
}

export interface CmEditorHandle {
	/** 当前全文 */
	getValue(): string;
	/** 外部改写全文（载入文章 / 保存流程改写插图路径）；与 doc 相同则跳过 */
	setValue(value: string): void;
	/** 光标处插入（插图/粘图），空行语义与旧 textarea 版 insertAtCursor 一致 */
	insertAtCursor(text: string): void;
	/** lua 配置热应用（批31）：缩进/换行/竖线/键位全部 Compartment 重配 */
	applyLua(spec: CmLuaSpec): Promise<void>;
	/** vim 热开关（Compartment 重配） */
	setVim(enabled: boolean): Promise<void>;
	focus(): void;
	/** 编辑侧内部滚动容器（scroll-sync 的源端） */
	scroller: HTMLElement;
	destroy(): void;
}

/** vim 模块惰性加载：默认关，不拖累首屏；开启/切换时才拉包 */
let vimModulePromise: Promise<typeof import("@replit/codemirror-vim")> | null =
	null;
function loadVim(): Promise<typeof import("@replit/codemirror-vim")> {
	vimModulePromise ??= import("@replit/codemirror-vim");
	return vimModulePromise;
}

/** @codemirror/language 惰性加载（indentUnit，lua tab_size 用） */
let langModulePromise: Promise<typeof import("@codemirror/language")> | null =
	null;
function loadLanguage(): Promise<typeof import("@codemirror/language")> {
	langModulePromise ??= import("@codemirror/language");
	return langModulePromise;
}

/** 多键序列缓冲的超时（类似 vim 的 jj 节奏，超时按普通输入回放） */
const SEQUENCE_TIMEOUT_MS = 1000;

export async function createMarkdownEditor(
	host: HTMLElement,
	options: CmEditorOptions,
): Promise<CmEditorHandle> {
	const [
		{ EditorView, placeholder, drawSelection, keymap },
		{ Compartment, EditorState, Prec },
		{ defaultKeymap, history, historyKeymap },
		{ markdown },
		{ indentationMarkers },
	] = await Promise.all([
		import("@codemirror/view"),
		import("@codemirror/state"),
		import("@codemirror/commands"),
		import("@codemirror/lang-markdown"),
		import("@replit/codemirror-indentation-markers"),
	]);
	let vimModule: typeof import("@replit/codemirror-vim") | null = null;
	if (options.vimEnabled) {
		vimModule = await loadVim();
	}
	const vimExt = vimModule ? vimModule.vim() : [];

	const vimCompartment = new Compartment();
	// lua 配置四件套（applyLua 全部走 reconfigure，默认值 = 站点默认形态）
	const wrapCompartment = new Compartment();
	const indentCompartment = new Compartment();
	const tabCompartment = new Compartment();
	const luaKeymapCompartment = new Compartment();
	let destroyed = false;
	// vim 态标记（键位随模式重排：vim 态 normal 归 vim API，CM 键位只承担 insert）
	let vimActive = options.vimEnabled;
	// 最近一次 lua 配置（setVim 切换后按新模式重排键位）
	let lastLuaSpec: CmLuaSpec | null = null;
	let lastTabSize: number | null = null;

	// ---- lua 键位执行 ----

	async function execRhs(rhs: LuaMapping["rhs"]): Promise<void> {
		try {
			if (rhs.kind === "command") {
				// 命令注册表在 editor-config（运行时才查，组件接线后注册 'save' 等）
				const { getEditorCommand } = await import("./editor-config");
				const fn = getEditorCommand(rhs.name);
				if (!fn) {
					console.warn(`[ff.lua] 未注册的编辑器命令，已忽略：${rhs.name}`);
					return;
				}
				fn();
			} else if (rhs.kind === "key") {
				dispatchParsedKey(rhs.key);
			} else {
				const fn = rhs.fn;
				if (typeof fn !== "function") {
					console.warn("[ff.lua] lua 函数不可调用，已忽略");
					return;
				}
				await Promise.resolve(fn()).catch((error) => {
					console.warn("[ff.lua] lua 函数执行失败：", error);
				});
			}
		} catch (error) {
			console.warn("[ff.lua] 键位映射执行失败：", error);
		}
	}

	/** vim 态光标是否处于插入模式（决定 CM 键位是否让路给 vim normal 运动） */
	function isVimInsertMode(v: CMEditorView): boolean {
		if (!vimModule) return false;
		try {
			return vimModule.getCM(v)?.state.vim?.insertMode === true;
		} catch {
			return false;
		}
	}

	/** rhs 为按键记法时的转发：vim 态 Escape 直达退出插入模式，其余合成 keydown */
	function dispatchParsedKey(key: ParsedKey): void {
		if (key.cmKey === "Escape" && vimActive && vimModule) {
			try {
				const shim = vimModule.getCM(view);
				if (shim) {
					// 运行时处于插入态必有 vim 状态；类型层 vim 可空，收窄之
					vimModule.Vim.exitInsertMode(shim as CodeMirrorV);
					return;
				}
			} catch {
				/* 落回合成按键 */
			}
		}
		view.contentDOM.dispatchEvent(
			new KeyboardEvent("keydown", {
				...key.eventInit,
				bubbles: true,
				cancelable: true,
			}),
		);
	}

	/** Tab → 空格（到下一个缩进停位；vim 态不注入此绑定，留给 vim 缩进） */
	function insertSpacesToTabStop(view: CMEditorView, size: number): boolean {
		const sel = view.state.selection.main;
		const line = view.state.doc.lineAt(sel.head);
		const col = sel.head - line.from;
		const spaces = " ".repeat(size - (col % size));
		view.dispatch({
			changes: { from: sel.from, to: sel.to, insert: spaces },
			selection: { anchor: sel.from + spaces.length },
		});
		return true;
	}

	/**
	 * 多键序列缓冲（无 vim 时 insert/normal 通用）：首键吞键进缓冲 → 命中执行 /
	 * 前缀继续等待 / 超时或岔开把缓冲字符按普通输入回放。
	 */
	function buildSequenceBindings(
		seqs: Array<{ keys: string; m: LuaMapping }>,
	): KeyBinding[] {
		const pending = { text: "" };
		let timer: number | undefined;
		const clearTimer = () => {
			if (timer !== undefined) {
				window.clearTimeout(timer);
				timer = undefined;
			}
		};
		const flush = (v: CMEditorView) => {
			clearTimer();
			const text = pending.text;
			pending.text = "";
			if (!text || destroyed) return;
			const sel = v.state.selection.main;
			v.dispatch({
				changes: { from: sel.from, to: sel.to, insert: text },
				selection: { anchor: sel.from + text.length },
			});
		};
		const advance = (v: CMEditorView, ch: string): boolean => {
			// vim 态只承担 insert 序列：非插入态放行（normal 键让给 vim 运动）
			if (vimActive && !isVimInsertMode(v)) return false;
			const next = pending.text + ch;
			clearTimer();
			const hit = seqs.find((s) => s.keys === next);
			if (hit) {
				pending.text = "";
				void execRhs(hit.m.rhs);
				return true;
			}
			if (seqs.some((s) => s.keys.startsWith(next))) {
				pending.text = next;
				timer = window.setTimeout(() => {
					timer = undefined;
					flush(v);
				}, SEQUENCE_TIMEOUT_MS);
				return true;
			}
			flush(v);
			return false;
		};
		const bindings: KeyBinding[] = [];
		for (const s of seqs) {
			if (!bindings.some((b) => b.key === s.keys[0])) {
				bindings.push({ key: s.keys[0], run: (v) => advance(v, s.keys[0]) });
			}
			for (let i = 1; i < s.keys.length; i++) {
				const ch = s.keys[i];
				// 已有同键绑定（首键/其他序列）时沿用：advance 对缓冲态统一处理
				if (!bindings.some((b) => b.key === ch)) {
					bindings.push({ key: ch, run: (v) => advance(v, ch) });
				}
			}
		}
		return bindings;
	}

	/** 组装 CM6 键位扩展：vim 态 normal 不进（由 vim API 承担） */
	function buildLuaKeyExt(mappings: LuaMapping[]): Extension {
		const singles: LuaMapping[] = [];
		const seqs: Array<{ keys: string; m: LuaMapping }> = [];
		for (const m of mappings) {
			if (vimActive && m.mode === "normal") continue;
			if (m.sequence) seqs.push({ keys: m.sequence, m });
			else if (m.key) singles.push(m);
		}
		const bindings: KeyBinding[] = [];
		if (!vimActive && lastTabSize) {
			const size = lastTabSize;
			bindings.push({ key: "Tab", run: (v) => insertSpacesToTabStop(v, size) });
		}
		for (const m of singles) {
			bindings.push({
				key: m.key?.cmKey ?? "",
				run: (v) => {
					// vim 态只承担 insert 映射：非插入态放行（normal 键让给 vim）
					if (vimActive && !isVimInsertMode(v)) return false;
					void execRhs(m.rhs);
					return true;
				},
			});
		}
		bindings.push(...buildSequenceBindings(seqs));
		// Prec.high：lua 键位压过 vim 插件的 keydown 处理（同为默认优先级时的
		// 面序依赖换成显式优先级）；未映射的键照样落到 vim / 默认键位
		return bindings.length > 0 ? Prec.high(keymap.of(bindings)) : [];
	}

	/** vim 开启时的 normal 映射：@replit/codemirror-vim 的 defineAction + mapCommand */
	function registerVimNormalMaps(mappings: LuaMapping[]): void {
		if (!vimModule) return;
		for (const m of mappings) {
			if (m.mode !== "normal") continue;
			// 稳定 action 名：同一 lhs 重注册 = 覆盖（mapCommand unshift 后最新优先）
			const name = `ff_map_${m.mode}_${m.notion.replace(/[^a-zA-Z0-9]/g, "_")}`;
			vimModule.Vim.defineAction(name, () => {
				void execRhs(m.rhs);
			});
			vimModule.Vim.mapCommand(
				m.notion,
				"action",
				name,
				{},
				{ context: "normal" },
			);
		}
	}

	const view = new EditorView({
		parent: host,
		state: EditorState.create({
			doc: options.value,
			extensions: [
				// P6：markdown 语言自带续行 keymap（Enter → insertNewlineContinueMarkup）
				markdown(),
				// 自动换行走 compartment（lua wrap=false 可关；默认开）
				wrapCompartment.of([EditorView.lineWrapping]),
				// P5：VSCode 式缩进竖线（markerType 默认 fullScope，整段完整竖线）
				indentCompartment.of([indentationMarkers()]),
				// lua 键位必须排在 defaultKeymap 之前（同优先级先声明先尝试）
				luaKeymapCompartment.of([]),
				tabCompartment.of([]),
				// 撤销栈（V8：Ctrl+Z 正常，插图插入等 dispatch 同样入栈）
				history(),
				keymap.of([...defaultKeymap, ...historyKeymap]),
				// vim 可视模式选区靠 drawSelection 绘制（原生浏览器选区画不了 block/多段）
				drawSelection(),
				vimCompartment.of(vimExt),
				placeholder(options.placeholder ?? ""),
				// 图片粘贴交组件根级 handlePaste 统一命名入库，阻断 CM/浏览器原生行为；
				// 文本粘贴仍走 CM 原生（contenteditable 默认行为）
				EditorView.domEventHandlers({
					paste(event) {
						const files = event.clipboardData?.files;
						if (!files?.length) return false;
						for (const file of Array.from(files)) {
							if (file.type.startsWith("image/")) {
								event.preventDefault();
								return true;
							}
						}
						return false;
					},
				}),
				EditorView.updateListener.of((update) => {
					if (update.docChanged) {
						options.onDocChange(update.state.doc.toString());
					}
				}),
				// 视觉对齐旧 textarea：透明背景、font/行高继承宿主（font-mono text-sm leading-7）、
				// 高度 80vh 由 CM scroller 内部滚动（P2 双窗内部滚动的前提）
				EditorView.theme({
					"&": {
						height: "80vh",
						backgroundColor: "transparent",
						fontSize: "inherit",
						color: "inherit",
					},
					"&.cm-focused": { outline: "none" },
					".cm-scroller": {
						overflow: "auto",
						fontFamily: "inherit",
						lineHeight: "1.75rem",
					},
					".cm-content": {
						padding: "4px 0",
						fontFamily: "inherit",
						lineHeight: "inherit",
						caretColor: "var(--primary, currentColor)",
					},
					".cm-line": { padding: "0 2px" },
					".cm-cursor": { borderLeftColor: "var(--primary, currentColor)" },
					".cm-placeholder": { color: "rgba(127, 127, 127, 0.6)" },
					".cm-selectionBackground": {
						backgroundColor:
							"color-mix(in srgb, var(--primary, #4aa3c0) 30%, transparent)",
					},
				}),
			],
		}),
	});

	return {
		getValue() {
			return view.state.doc.toString();
		},
		setValue(value: string) {
			if (destroyed) return;
			if (view.state.doc.toString() === value) return;
			view.dispatch({
				changes: { from: 0, to: view.state.doc.length, insert: value },
			});
		},
		insertAtCursor(text: string) {
			if (destroyed) return;
			const selection = view.state.selection.main;
			// 与旧 textarea 版一致：行首插入不加空行，行中插入补空行隔开
			const before = view.state.doc.sliceString(0, selection.from);
			const prefix = before === "" || before.endsWith("\n") ? "" : "\n\n";
			const inserted = `${prefix}${text}\n`;
			view.dispatch({
				changes: {
					from: selection.from,
					to: selection.to,
					insert: inserted,
				},
				selection: { anchor: selection.from + inserted.length },
				scrollIntoView: true,
			});
			view.focus();
		},
		async applyLua(spec: CmLuaSpec) {
			if (destroyed) return;
			const mappings = spec.mappings ?? [];
			lastLuaSpec = spec;
			// vim 态 normal 映射注册进 vim API（vim 关着时注册无害，开了即生效）
			if (vimModule) registerVimNormalMaps(mappings);
			const tabSize =
				typeof spec.tabSize === "number" &&
				Number.isInteger(spec.tabSize) &&
				spec.tabSize >= 1
					? spec.tabSize
					: null;
			lastTabSize = tabSize;
			const { indentUnit } = await loadLanguage();
			if (destroyed) return;
			view.dispatch({
				effects: [
					tabCompartment.reconfigure(
						tabSize
							? [
									EditorState.tabSize.of(tabSize),
									indentUnit.of(" ".repeat(tabSize)),
								]
							: [],
					),
					wrapCompartment.reconfigure(
						spec.wrap === false ? [] : [EditorView.lineWrapping],
					),
					indentCompartment.reconfigure(
						spec.indentGuides === false ? [] : [indentationMarkers()],
					),
					luaKeymapCompartment.reconfigure(buildLuaKeyExt(mappings)),
				],
			});
		},
		async setVim(enabled: boolean) {
			if (destroyed) return;
			const mod = await loadVim();
			if (destroyed) return; // await 期间可能已卸载
			vimModule = mod;
			vimActive = enabled;
			// vim 首次开启：lua 的 normal 映射此时才注册进 vim API（此前注册无效负载）
			if (enabled && lastLuaSpec) {
				registerVimNormalMaps(lastLuaSpec.mappings ?? []);
			}
			view.dispatch({
				effects: [
					vimCompartment.reconfigure(enabled ? mod.vim() : []),
					// 键位随模式重排：vim 态 normal 由 vim API 接管，CM 键位只留 insert
					...(lastLuaSpec
						? [
								luaKeymapCompartment.reconfigure(
									buildLuaKeyExt(lastLuaSpec.mappings ?? []),
								),
							]
						: []),
				],
			});
		},
		focus() {
			if (!destroyed) view.focus();
		},
		get scroller(): HTMLElement {
			return view.scrollDOM;
		},
		destroy() {
			if (destroyed) return;
			destroyed = true;
			view.destroy();
		},
	};
}
