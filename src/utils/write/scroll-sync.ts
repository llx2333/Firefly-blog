// 共用单调映射的正反函数，驱动侧切换才不会改变已经对齐的位置。

import type { EditorView } from "@codemirror/view";
import { SOURCE_LINE_ATTR } from "./line-anchors";

export interface ScrollSyncOptions {
	/** 是否同步（例如 () => layout === "split"）；默认恒开 */
	enabled?: () => boolean;
	/** 按值匹配的回声记录保留时间；默认 120ms */
	echoFallbackMs?: number;
}

export interface ScrollSyncHandle {
	setEnabled(enabled: boolean): void;
	destroy(): void;
}

type Side = "editor" | "preview";

interface Anchor {
	line: number;
	top: number;
}

interface MappingPoint {
	editor: number;
	preview: number;
}

interface Measurement {
	revision: number;
	movement: {
		driver: Side;
		target: Side;
		value: number;
		current: number;
	} | null;
}

const SCROLL_EPSILON = 1;
const clamp = (value: number, min: number, max: number) =>
	Math.min(max, Math.max(min, value));

/** 输入已按源码行排序。只跳过局部退化/倒序点，始终保留两个端点。 */
function buildMapping(
	anchors: readonly MappingPoint[],
	totalEditor: number,
	totalPreview: number,
): MappingPoint[] {
	const points: MappingPoint[] = [{ editor: 0, preview: 0 }];
	for (const point of anchors) {
		const previous = points[points.length - 1];
		if (
			Number.isFinite(point.editor) &&
			Number.isFinite(point.preview) &&
			point.editor > previous.editor &&
			point.preview > previous.preview &&
			point.editor < totalEditor &&
			point.preview < totalPreview
		) {
			points.push(point);
		}
	}
	points.push({ editor: totalEditor, preview: totalPreview });
	return points;
}

/** 两个方向共享点组和分段；严格单调保证每段均有唯一的逆。 */
function mapContentPoint(
	points: readonly MappingPoint[],
	value: number,
	from: Side,
): number {
	const to = from === "editor" ? "preview" : "editor";
	const x = clamp(value, 0, points[points.length - 1][from]);
	let low = 0;
	let high = points.length - 1;
	while (high - low > 1) {
		const mid = (low + high) >>> 1;
		if (points[mid][from] <= x) low = mid;
		else high = mid;
	}
	const a = points[low];
	const b = points[high];
	return a[to] + ((x - a[from]) / (b[from] - a[from])) * (b[to] - a[to]);
}

function samePoints(
	a: readonly MappingPoint[],
	b: readonly MappingPoint[],
): boolean {
	return (
		a.length === b.length &&
		a.every(
			(point, index) =>
				point.editor === b[index].editor && point.preview === b[index].preview,
		)
	);
}

/** 固定定位的容器也可见，不能仅凭 offsetParent 判定。仅在 read 阶段调用。 */
function isVisible(el: HTMLElement): boolean {
	return (
		el.isConnected &&
		el.clientWidth > 0 &&
		el.clientHeight > 0 &&
		el.getClientRects().length > 0 &&
		!["hidden", "collapse"].includes(getComputedStyle(el).visibility)
	);
}

function readPreviewAnchors(preview: HTMLElement): Anchor[] {
	const containerTop = preview.getBoundingClientRect().top;
	const scrollTop = preview.scrollTop;
	const candidates = new Map<
		number,
		{ top: number; element: HTMLElement; priority: number }
	>();
	for (const el of preview.querySelectorAll<HTMLElement>(
		`[${SOURCE_LINE_ATTR}]`,
	)) {
		const line = Number(el.getAttribute(SOURCE_LINE_ATTR));
		if (!Number.isInteger(line) || line < 1 || !el.getClientRects().length)
			continue;
		const style = getComputedStyle(el);
		if (style.visibility === "hidden" || style.visibility === "collapse")
			continue;
		// scrollHeight/CM 行顶都包含 padding；这里只去掉容器边框，不能再减 padding。
		const top =
			el.getBoundingClientRect().top -
			containerTop -
			preview.clientTop +
			scrollTop;
		if (!Number.isFinite(top)) continue;
		// 同行优先代码正文子块，兄弟锚点取较早顶边。
		const priority =
			el.tagName !== "PRE" && el.closest("pre")
				? 2
				: style.display === "inline" || style.display === "contents"
					? 0
					: 1;
		const previous = candidates.get(line);
		if (
			!previous ||
			priority > previous.priority ||
			(priority === previous.priority &&
				(previous.element.contains(el) ||
					(!el.contains(previous.element) && top < previous.top)))
		) {
			candidates.set(line, { top, element: el, priority });
		}
	}
	return Array.from(candidates, ([line, candidate]) => ({
		line,
		top: candidate.top,
	})).sort((a, b) => a.line - b.line);
}

export function createScrollSync(
	view: EditorView,
	preview: HTMLElement,
	options: ScrollSyncOptions = {},
): ScrollSyncHandle {
	let enabledFn = options.enabled ?? (() => true);
	const echoFallbackMs = options.echoFallbackMs ?? 120;
	const scroller = view.scrollDOM;
	const elements = { editor: scroller, preview };
	let destroyed = false;
	let driver: Side | null = null;
	let revision = 0;
	let raf = 0;
	let measurePending = false;
	let previewDirty = true;
	let previewSignature = "";
	let anchors: Anchor[] = [];
	let measuredPoints: MappingPoint[] = [];
	let mapping: MappingPoint[] | null = null;
	const echoes: Record<Side, { value: number; timer: number } | null> = {
		editor: null,
		preview: null,
	};

	function clearEcho(side: Side) {
		const echo = echoes[side];
		if (echo) window.clearTimeout(echo.timer);
		echoes[side] = null;
	}

	function scheduleFrame() {
		if (destroyed || raf || measurePending || !enabledFn()) return;
		raf = requestAnimationFrame(() => {
			raf = 0;
			if (destroyed || !enabledFn()) return;
			measurePending = true;
			view.requestMeasure(measureRequest);
		});
	}

	function requestSync() {
		revision++;
		scheduleFrame();
	}

	function invalidatePreview() {
		previewDirty = true;
		requestSync();
	}

	function readMeasurement(): Measurement {
		const result: Measurement = { revision, movement: null };
		if (
			destroyed ||
			!enabledFn() ||
			!isVisible(scroller) ||
			!isVisible(preview)
		)
			return result;
		const totalEditor = scroller.scrollHeight;
		const totalPreview = preview.scrollHeight;
		const maxEditor = totalEditor - scroller.clientHeight;
		const maxPreview = totalPreview - preview.clientHeight;
		if (maxEditor <= 0 || maxPreview <= 0) return result;

		const signature = `${totalPreview}/${preview.clientWidth}/${preview.clientHeight}`;
		if (previewDirty || signature !== previewSignature) {
			anchors = readPreviewAnchors(preview);
			previewSignature = signature;
			previewDirty = false;
		}
		const doc = view.state.doc;
		const paddingTop = view.documentPadding.top;
		const nextPoints: MappingPoint[] = [];
		for (const anchor of anchors) {
			// 预览异步重渲前可能暂时含有旧文档的行号；不能钳到文末制造假锚点。
			if (anchor.line > doc.lines) continue;
			nextPoints.push({
				editor: view.lineBlockAt(doc.line(anchor.line).from).top + paddingTop,
				preview: anchor.top,
			});
		}
		// 不仅比较 scrollHeight：CM 可在总高不变时重新测准局部行/折行高度。
		if (
			!mapping ||
			mapping[mapping.length - 1].editor !== totalEditor ||
			mapping[mapping.length - 1].preview !== totalPreview ||
			!samePoints(measuredPoints, nextPoints)
		) {
			measuredPoints = nextPoints;
			mapping = buildMapping(nextPoints, totalEditor, totalPreview);
		}
		if (!driver) return result;

		const target = driver === "editor" ? "preview" : "editor";
		const sourceMax = driver === "editor" ? maxEditor : maxPreview;
		const targetMax = driver === "editor" ? maxPreview : maxEditor;
		const sourceTotal = driver === "editor" ? totalEditor : totalPreview;
		const targetTotal = driver === "editor" ? totalPreview : totalEditor;
		const point =
			(clamp(elements[driver].scrollTop, 0, sourceMax) * sourceTotal) /
			sourceMax;
		result.movement = {
			driver,
			target,
			value: clamp(
				(mapContentPoint(mapping, point, driver) * targetMax) / targetTotal,
				0,
				targetMax,
			),
			current: elements[target].scrollTop,
		};
		return result;
	}

	function writeMeasurement(measurement: Measurement) {
		const movement = measurement.movement;
		if (
			!destroyed &&
			enabledFn() &&
			measurement.revision === revision &&
			movement &&
			movement.driver === driver &&
			Math.abs(movement.current - movement.value) > SCROLL_EPSILON
		) {
			const side = movement.target;
			clearEcho(side);
			const echo = { value: movement.value, timer: 0 };
			echoes[side] = echo;
			echo.timer = window.setTimeout(() => {
				if (echoes[side] === echo) echoes[side] = null;
			}, echoFallbackMs);
			// 保留小数；浏览器的亚像素误差只在比较/回声判定时容忍。
			elements[side].scrollTop = movement.value;
		}
		measurePending = false;
		// 测量期间有新内容/交互才再排一帧，不能每次 write 都自行续帧。
		if (measurement.revision !== revision) scheduleFrame();
	}

	const measureRequest = {
		key: {},
		read: readMeasurement,
		write: writeMeasurement,
	};

	function onIntent(side: Side) {
		if (destroyed) return;
		driver = side;
		clearEcho(side);
		revision++;
		// 交互本身不滚动就不写；切换驱动无需重新对齐/吸附。
	}

	function onScroll(side: Side) {
		if (destroyed) return;
		const echo = echoes[side];
		if (
			echo &&
			Math.abs(elements[side].scrollTop - echo.value) <= SCROLL_EPSILON
		) {
			clearEcho(side);
			return;
		}
		clearEcho(side);
		if (!enabledFn()) return;
		// 首次滚动可建立 driver；随后只有主动交互能换侧，避免 CM 重测量夺权。
		if (!driver) driver = side;
		requestSync();
	}

	const onEditorScroll = () => onScroll("editor");
	const onPreviewScroll = () => onScroll("preview");
	const onEditorIntent = () => onIntent("editor");
	const onPreviewIntent = () => onIntent("preview");
	const intentEvents = [
		"wheel",
		"pointerdown",
		"touchstart",
		"keydown",
	] as const;
	scroller.addEventListener("scroll", onEditorScroll, { passive: true });
	preview.addEventListener("scroll", onPreviewScroll, { passive: true });
	for (const type of intentEvents) {
		scroller.addEventListener(type, onEditorIntent, {
			capture: true,
			passive: true,
		});
		preview.addEventListener(type, onPreviewIntent, {
			capture: true,
			passive: true,
		});
	}

	const resizeSizes = new Map<Element, { width: number; height: number }>();
	const previewContents = new Set<Element>();
	const ro = new ResizeObserver((entries) => {
		if (destroyed) return;
		let changed = false;
		for (const entry of entries) {
			const size = {
				width: entry.contentRect.width,
				height: entry.contentRect.height,
			};
			const previous = resizeSizes.get(entry.target);
			if (previous?.width === size.width && previous.height === size.height)
				continue;
			resizeSizes.set(entry.target, size);
			changed = true;
			if (entry.target !== scroller && entry.target !== view.contentDOM)
				previewDirty = true;
		}
		// 同尺寸的重复 RO 通知不失效、不续帧，避免 RO → scroll → RO 循环。
		if (changed) requestSync();
	});

	function observePreviewContents() {
		const children = new Set(preview.children);
		for (const old of previewContents) {
			if (children.has(old)) continue;
			ro.unobserve(old);
			resizeSizes.delete(old);
			previewContents.delete(old);
		}
		for (const child of children) {
			if (previewContents.has(child)) continue;
			previewContents.add(child);
			ro.observe(child);
		}
	}

	const previewMo = new MutationObserver(() => {
		if (destroyed) return;
		// innerHTML 换新后也要观察新的内容层，不能只持有首次的 firstElementChild。
		observePreviewContents();
		invalidatePreview();
	});
	previewMo.observe(preview, {
		childList: true,
		subtree: true,
		characterData: true,
		attributes: true,
	});
	// CM 文本/装饰/虚拟占位变化会更新 heightmap，且不一定改变 content 总高。
	const editorMo = new MutationObserver(() => {
		if (!destroyed) requestSync();
	});
	editorMo.observe(view.contentDOM, {
		childList: true,
		subtree: true,
		characterData: true,
		attributes: true,
		attributeFilter: ["style", "class"],
	});
	ro.observe(scroller);
	ro.observe(view.contentDOM);
	ro.observe(preview);
	observePreviewContents();

	return {
		setEnabled(enabled: boolean) {
			if (destroyed) return;
			enabledFn = () => enabled;
			revision++;
			if (enabled) invalidatePreview();
			else {
				if (raf) cancelAnimationFrame(raf);
				raf = 0;
				clearEcho("editor");
				clearEcho("preview");
			}
		},
		destroy() {
			if (destroyed) return;
			destroyed = true;
			scroller.removeEventListener("scroll", onEditorScroll);
			preview.removeEventListener("scroll", onPreviewScroll);
			for (const type of intentEvents) {
				scroller.removeEventListener(type, onEditorIntent, true);
				preview.removeEventListener(type, onPreviewIntent, true);
			}
			previewMo.disconnect();
			editorMo.disconnect();
			ro.disconnect();
			if (raf) cancelAnimationFrame(raf);
			raf = 0;
			clearEcho("editor");
			clearEcho("preview");
			previewContents.clear();
			resizeSizes.clear();
			anchors = [];
			measuredPoints = [];
			mapping = null;
			// requestMeasure 无公开取消方法；尚未执行的 CM 回调由 destroyed 守卫空转。
		},
	};
}
