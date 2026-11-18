/**
 * P2→批37：编辑 ↔ 预览滚动同步——「行号锚点」算法（真·VSCode 式），
 * 替换原先的「可视比例」百分比口径（两侧内容总高接近时像素距离几乎相等，
 * 且同屏内容互不对应，观感是「硬凑」；用户拍板直接替换，不留比例兜底）。
 *
 * 数据层：line-anchors.ts 在 marked 渲染期给每个**块级**元素打 data-line（源码行号，
 * 含列表项内部的段落/代码块——批41 起不再只有顶层块，长列表中央也有锚点）。
 * 双向同步按锚点段内插值：
 * - 编辑→预览：取 CM 顶部可见行的浮点行号（行号 + 行内进度），落在哪个锚点段
 *   就按行距比例映射到预览 scrollTop——两侧滚动距离天然不同（各按各的内容
 *   高度换算），同屏内容实时对应，即 VSCode 预览的行为；
 * - 预览→编辑：预览 scrollTop 落在哪个锚点段，反算浮点行号 → CM scrollTop。
 * 最后锚点之后按「末段行距/像素比」外推（两个方向对称），不再冻结在最后锚点；
 * 任一侧滚到顶/底，对侧吸附到顶/底（纯行号锚点覆盖不到两端的死区）。
 *
 * 防振荡两件套沿用旧实现：
 * - 回声按值匹配：程序改写对侧 scrollTop 后，若对侧随后到来的 scroll 事件位置
 *   恰好等于我们写入的值，判为回声吞掉，绝不回采（否则两侧互相触发、指数级抖动）；
 *   位置不同则是真实滚动（含脚本快速交替），照常同步。
 * - 兜底定时器：目标位置恰好等于当前值时浏览器不发 scroll 事件，回声等不到，
 *   120ms 后清除待定回声，防止误判卡死。
 * - rAF 合帧：连续滚动一帧只算一次，丢掉中间态；每个方向独立槽位（CM6 measure
 *   会在程序滚动后微调 scroller scrollTop 再发一次事件，跨方向互吃会丢同步）。
 *
 * 锚点缓存：按 scrollHeight×clientHeight 签名惰性重建，另挂 ResizeObserver
 * （预览卡与内容层尺寸变化——图片/字体加载）和 MutationObserver（innerHTML 重渲）
 * 主动失效；锚点按 top 排序后校验源码行号单调，乱序（对位错）直接弃用全部锚点，
 * 宁可不同步也不送到错位置。锚点缺失（内容不足一屏等）时同步自动空转，
 * 不影响任何功能。
 *
 * CM6 坐标口径（node_modules 实证）：heightMap 坐标 0 = 首行行顶；可见顶 =
 * scrollDOM.scrollTop - documentPadding.top；按行定位 = block.top + 行内进度
 * × block.height + documentPadding.top。
 *
 * 只在「双窗态且两侧卡都可见」时生效（enabled 回调由组件按布局态传入）；
 * 单预览态预览卡回归页面级滚动，单编辑态对侧隐藏，守卫照旧安全空转。
 */

import type { EditorView } from "@codemirror/view";
import { SOURCE_LINE_ATTR } from "./line-anchors";

export interface ScrollSyncOptions {
	/** 是否同步（组件按布局态传入，如 () => layout === "split"）；默认恒开 */
	enabled?: () => boolean;
	/** 回声兜底解锁毫秒数；默认 120ms */
	echoFallbackMs?: number;
}

export interface ScrollSyncHandle {
	/** 运行中改开关（不必销毁重建） */
	setEnabled(enabled: boolean): void;
	/** 解绑监听（组件卸载 / 重建配对时调用） */
	destroy(): void;
}

/** 预览锚点：顶层块的首行源码行号 + 在预览内容坐标里的顶边位置 */
interface Anchor {
	line: number;
	top: number;
}

function clamp01(v: number): number {
	return v < 0 ? 0 : v > 1 ? 1 : v;
}

const isVisible = (el: HTMLElement) => el.offsetParent !== null;

export function createScrollSync(
	view: EditorView,
	preview: HTMLElement,
	options: ScrollSyncOptions = {},
): ScrollSyncHandle {
	let enabledFn = options.enabled ?? (() => true);
	const echoFallbackMs = options.echoFallbackMs ?? 120;
	const scroller = view.scrollDOM;
	/** 刚写入对侧的 scrollTop 值（按值匹配回声，而非盲吞下一条事件） */
	let pendingEcho: { el: HTMLElement; value: number } | null = null;
	let echoTimer = 0;
	/** 每个方向独立 rAF 槽位（见文件头） */
	let rafEditor = 0;
	let rafPreview = 0;

	// 锚点缓存：签名（高度）或 RO/MO 失效标记变化时重建
	let anchors: Anchor[] | null = null;
	let anchorSig = "";

	function anchorSignature(): string {
		return `${preview.scrollHeight}×${preview.clientHeight}`;
	}

	/** 内容/尺寸变化由观察器主动置空缓存（见下方 RO/MO） */
	function invalidateAnchors() {
		anchors = null;
	}

	function getAnchors(): Anchor[] {
		const sig = anchorSignature();
		if (anchors && sig === anchorSig) return anchors;
		const list: Anchor[] = [];
		const cRect = preview.getBoundingClientRect();
		const cTop = cRect.top + preview.clientTop;
		const padTop =
			preview.clientTop +
			(Number.parseFloat(getComputedStyle(preview).paddingTop) || 0);
		const scroll = preview.scrollTop;
		for (const el of preview.querySelectorAll<HTMLElement>(
			`[${SOURCE_LINE_ATTR}]`,
		)) {
			const line = Number(el.getAttribute(SOURCE_LINE_ATTR));
			if (!Number.isFinite(line) || line < 1) continue;
			list.push({
				line,
				top: el.getBoundingClientRect().top - cTop + scroll - padTop,
			});
		}
		list.sort((a, b) => a.top - b.top);
		// 行号必须随视觉位置单调不减（同布局同块可相等，如 li 与其首个子块）；
		// 出现下降说明对位错乱——弃用全部锚点，退化为不同步（宁缺勿错）
		for (let i = 1; i < list.length; i++) {
			if (list[i].line < list[i - 1].line) {
				anchors = null;
				anchorSig = "";
				return [];
			}
		}
		anchors = list;
		anchorSig = sig;
		return list;
	}

	/** 末段斜率（像素/行），供最后锚点之后的外推；段退化时返回 null */
	function tailSlope(as: Anchor[]): number | null {
		if (as.length < 2) return null;
		const a = as[as.length - 2];
		const b = as[as.length - 1];
		const spanLines = b.line - a.line;
		const spanPx = b.top - a.top;
		if (spanLines <= 0 || spanPx <= 0) return null;
		return spanPx / spanLines;
	}

	/** 编辑器顶部可见位置的浮点行号（1-based 行 + 行内进度 0..1） */
	function editorTopFloat(): number {
		const h = Math.max(0, scroller.scrollTop - view.documentPadding.top);
		const block = view.lineBlockAtHeight(h);
		const line = view.state.doc.lineAt(block.from);
		const frac = block.height > 0 ? (h - block.top) / block.height : 0;
		return line.number + clamp01(frac);
	}

	/** 浮点行号 → 编辑器目标 scrollTop（顶边对齐；writeScroll 再统一钳制） */
	function editorScrollValue(f: number): number {
		const doc = view.state.doc;
		const li = Math.min(doc.lines, Math.max(1, Math.floor(f)));
		const block = view.lineBlockAt(doc.line(li).from);
		return (
			block.top + clamp01(f - li) * block.height + view.documentPadding.top
		);
	}

	/** 浮点行号 → 预览目标 scrollTop：落点所在锚点段内按行距比例插值 */
	function previewTargetFor(f: number): number | null {
		const as = getAnchors();
		if (!as.length) return null;
		if (f <= as[0].line) return as[0].top * clamp01(f / as[0].line);
		for (let i = 0; i < as.length - 1; i++) {
			if (f < as[i + 1].line) {
				const span = as[i + 1].line - as[i].line;
				const k = span > 0 ? (f - as[i].line) / span : 0;
				return as[i].top + k * (as[i + 1].top - as[i].top);
			}
		}
		// 最后锚点之后：按末段斜率外推（列表/代码块常延伸到文末，冻结会「右栏还在开头」）
		const last = as[as.length - 1];
		const slope = tailSlope(as);
		if (slope === null) return last.top;
		return last.top + (f - last.line) * slope;
	}

	/** 预览 scrollTop → 浮点行号：落点所在锚点段内按像素比例插值 */
	function editorTargetFor(scrollTop: number): number | null {
		const as = getAnchors();
		if (!as.length) return null;
		if (scrollTop <= as[0].top) return as[0].line;
		for (let i = 0; i < as.length - 1; i++) {
			if (scrollTop < as[i + 1].top) {
				const span = as[i + 1].top - as[i].top;
				const k = span > 0 ? (scrollTop - as[i].top) / span : 0;
				return as[i].line + k * (as[i + 1].line - as[i].line);
			}
		}
		const last = as[as.length - 1];
		const slope = tailSlope(as);
		if (slope === null) return last.line;
		return last.line + (scrollTop - last.top) / slope;
	}

	function clearEcho() {
		pendingEcho = null;
		clearTimeout(echoTimer);
	}

	function writeScroll(to: HTMLElement, value: number | null) {
		if (value === null) return;
		const max = to.scrollHeight - to.clientHeight;
		const v = Math.round(Math.min(max, Math.max(0, value)));
		pendingEcho = { el: to, value: v };
		clearTimeout(echoTimer);
		echoTimer = window.setTimeout(() => {
			pendingEcho = null;
		}, echoFallbackMs);
		if (to.scrollTop !== v) to.scrollTop = v;
		else clearEcho(); // 位置不变不会来事件，回声当场结清
	}

	function apply(direction: "editor" | "preview") {
		if (!enabledFn()) return;
		// 任一侧当前不可见（隐藏卡 / 手机单卡）时不同步，防止对隐藏元素写 scrollTop
		if (isVisible(scroller) === false || isVisible(preview) === false) return;
		const maxE = scroller.scrollHeight - scroller.clientHeight;
		const maxP = preview.scrollHeight - preview.clientHeight;
		if (maxE <= 0 || maxP <= 0) return; // 任一侧不可滚：没有可映射的距离
		if (direction === "editor") {
			let target: number | null = null;
			if (scroller.scrollTop <= 0) target = 0;
			else if (scroller.scrollTop >= maxE - 1) target = maxP;
			else target = previewTargetFor(editorTopFloat());
			writeScroll(preview, target);
		} else {
			let target: number | null = null;
			if (preview.scrollTop <= 0) target = 0;
			else if (preview.scrollTop >= maxP - 1) target = maxE;
			else {
				const f = editorTargetFor(preview.scrollTop);
				target = f === null ? null : editorScrollValue(f);
			}
			writeScroll(scroller, target);
		}
	}

	function makeHandler(
		direction: "editor" | "preview",
		el: HTMLElement,
		slot: () => number,
		setSlot: (v: number) => void,
	) {
		return () => {
			if (
				pendingEcho &&
				pendingEcho.el === el &&
				el.scrollTop === pendingEcho.value
			) {
				// 回声：位置与我们写入的值一致，吞掉并解锁
				clearEcho();
				return;
			}
			clearEcho(); // 位置不同的滚动 = 真实滚动，待定回声作废
			if (slot()) cancelAnimationFrame(slot());
			setSlot(
				requestAnimationFrame(() => {
					setSlot(0);
					apply(direction);
				}),
			);
		};
	}

	const onEditorScroll = makeHandler(
		"editor",
		scroller,
		() => rafEditor,
		(v) => {
			rafEditor = v;
		},
	);
	const onPreviewScroll = makeHandler(
		"preview",
		preview,
		() => rafPreview,
		(v) => {
			rafPreview = v;
		},
	);
	scroller.addEventListener("scroll", onEditorScroll, { passive: true });
	preview.addEventListener("scroll", onPreviewScroll, { passive: true });

	// 预览内容变化 → 锚点缓存即刻作废（句柄不再随 body 逐键重建）：
	// - MutationObserver：{@html} 整段换新（打字重渲）或预览链后处理改写子树；
	// - ResizeObserver：图片/字体加载、窗口缩放导致内容层高度变化（这类变化
	//   不一定改 scrollHeight 签名，但会移动块内锚点）。
	const mo = new MutationObserver(invalidateAnchors);
	mo.observe(preview, { childList: true, subtree: true, characterData: true });
	const ro = new ResizeObserver(invalidateAnchors);
	ro.observe(preview);
	const content = preview.firstElementChild;
	if (content) ro.observe(content);

	return {
		setEnabled(enabled: boolean) {
			enabledFn = () => enabled;
		},
		destroy() {
			scroller.removeEventListener("scroll", onEditorScroll);
			preview.removeEventListener("scroll", onPreviewScroll);
			mo.disconnect();
			ro.disconnect();
			if (rafEditor) cancelAnimationFrame(rafEditor);
			if (rafPreview) cancelAnimationFrame(rafPreview);
			clearTimeout(echoTimer);
			anchors = null;
		},
	};
}
