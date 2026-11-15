/**
 * CM6 编辑器统一装配（WriteEditor / PostEditor 共用，组件只绑定不装配）。
 *
 * 装配内容（批30 P5/P6/P7）：
 * - markdown 语言（lang-markdown 内置 markdownKeymap：Enter 自动续行——列表补
 *   `- `、缩进行保持缩进、普通段落不加重缩进、围栏代码块续行）；
 * - indentation-markers：VSCode 式缩进竖线（颜色随站点明暗，见 write-surface.css
 *   的 --indent-marker-* 覆写）；
 * - history + historyKeymap：Ctrl+Z / Ctrl+Y 撤销重做（替代原 textarea 的浏览器原生）；
 * - vim 扩展经 Compartment 热开关（ff.editor.vim，默认关；@replit/codemirror-vim
 *   需 drawSelection 渲染可视模式选区）。
 *
 * SSR 纪律：全部 CM 运行时依赖走动态 import，只在客户端（onMount 后）执行——
 * client:load 岛屿在 SSR/构建期也会跑模块顶层，CM6 在 Node 下缺 DOM 会炸。
 * svelte-codemirror-editor 不采用：需要自定义 vim Compartment / scroller 暴露 /
 * 视觉对齐旧 textarea，直装 EditorView 控制力更完整（已 pnpm remove 该包）。
 */

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

export interface CmEditorHandle {
	/** 当前全文 */
	getValue(): string;
	/** 外部改写全文（载入文章 / 保存流程改写插图路径）；与 doc 相同则跳过 */
	setValue(value: string): void;
	/** 光标处插入（插图/粘图），空行语义与旧 textarea 版 insertAtCursor 一致 */
	insertAtCursor(text: string): void;
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

export async function createMarkdownEditor(
	host: HTMLElement,
	options: CmEditorOptions,
): Promise<CmEditorHandle> {
	const [
		{ EditorView, placeholder, drawSelection, keymap },
		{ Compartment, EditorState },
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
	const vimExt = options.vimEnabled ? (await loadVim()).vim() : [];

	const vimCompartment = new Compartment();
	let destroyed = false;

	const view = new EditorView({
		parent: host,
		state: EditorState.create({
			doc: options.value,
			extensions: [
				// P6：markdown 语言自带续行 keymap（Enter → insertNewlineContinueMarkup）
				markdown(),
				EditorView.lineWrapping,
				// P5：VSCode 式缩进竖线（markerType 默认 fullScope，整段完整竖线）
				indentationMarkers(),
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
		async setVim(enabled: boolean) {
			if (destroyed) return;
			const ext = enabled ? (await loadVim()).vim() : [];
			if (destroyed) return; // await 期间可能已卸载
			view.dispatch({ effects: vimCompartment.reconfigure(ext) });
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
