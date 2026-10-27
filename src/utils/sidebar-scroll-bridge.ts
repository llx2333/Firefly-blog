/**
 * 侧栏滚动接力（批14b）
 *
 * 阅读页侧栏是独立滚动区：指针悬停侧栏时，滚轮由浏览器原生滚它。
 * 但页面滚到顶/底之后，指针仍在正文区时滚轮无处可去（页面已经到边界），
 * 这里把这段增量转给侧栏——恢复「文章滚到底，继续滚就是滚侧栏」的手感。
 *
 * 监听挂在常驻的 #content-panel-inner 上（内含 #main-grid 与页脚）：它不在 swup
 * 的替换容器里，站内切页不会失效；元素级 wheel 默认非 passive，天然等价「指针在
 * 主内容区」，也不必给整个文档的滚轮事件加主线程开销。
 */

const ROOT_SELECTOR = "#content-panel-inner";
const RAIL_IDS = ["right-sidebar", "left-sidebar"] as const;
const LINE_HEIGHT = 16;

declare global {
	interface Window {
		__sidebarScrollBridgeInit?: boolean;
	}
}

function pageAtBottom(): boolean {
	const root = document.documentElement;
	return window.scrollY + window.innerHeight >= root.scrollHeight - 2;
}

function pageAtTop(): boolean {
	return window.scrollY <= 0;
}

/** 目标与根容器之间若存在可纵向滚动的容器（代码块、表格包装等），交给原生滚动 */
function hasInnerVerticalScroller(target: Element, root: Element): boolean {
	let node: Element | null = target;
	while (node && node !== root) {
		const { overflowY } = getComputedStyle(node);
		if (
			(overflowY === "auto" || overflowY === "scroll") &&
			node.scrollHeight > node.clientHeight + 1
		) {
			return true;
		}
		node = node.parentElement;
	}
	return false;
}

function normalizeDelta(event: WheelEvent): number {
	if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
		return event.deltaY * LINE_HEIGHT;
	}
	if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
		return event.deltaY * window.innerHeight;
	}
	return event.deltaY;
}

/** 取一个在该方向上还能滚的侧栏；没有就返回 null */
function pickRail(delta: number): HTMLElement | null {
	for (const id of RAIL_IDS) {
		const rail = document.getElementById(id);
		if (!rail) continue;
		const max = rail.scrollHeight - rail.clientHeight;
		if (max <= 1) continue;
		if (delta > 0 ? rail.scrollTop < max - 1 : rail.scrollTop > 0) return rail;
	}
	return null;
}

function onWheel(event: WheelEvent): void {
	if (event.defaultPrevented || event.ctrlKey || event.metaKey) return;

	const target = event.target;
	if (!(target instanceof Element)) return;
	// 指针在侧栏上：原生滚动，别抢
	if (target.closest("#right-sidebar, #left-sidebar")) return;

	// 横向为主的触控板手势（侧滑返回、横向表格）不参与接力
	if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;

	const delta = normalizeDelta(event);
	if (delta === 0) return;

	// 只在页面已经到边界时接力，其余情况保持原来的页面滚动
	if (delta > 0 ? !pageAtBottom() : !pageAtTop()) return;

	const rail = pickRail(delta);
	if (!rail) return;

	const root = event.currentTarget;
	if (root instanceof Element && hasInnerVerticalScroller(target, root)) return;

	const max = rail.scrollHeight - rail.clientHeight;
	event.preventDefault();
	rail.scrollTop = Math.min(max, Math.max(0, rail.scrollTop + delta));
}

/** 站内切页后侧栏回到顶部，避免新文章一进来目录就在视口外 */
function resetRails(): void {
	for (const id of RAIL_IDS) {
		const rail = document.getElementById(id);
		if (rail) rail.scrollTop = 0;
	}
}

export function initSidebarScrollBridge(): void {
	// swup 切页会重跑模块化脚本，模块级变量拦不住：用 window 标记（本仓既有做法）
	// + 根节点 dataset 双重去重，避免常驻节点上叠出第二个非 passive wheel 监听器。
	if (window.__sidebarScrollBridgeInit) return;
	window.__sidebarScrollBridgeInit = true;

	const attach = (): void => {
		const root = document.querySelector<HTMLElement>(ROOT_SELECTOR);
		if (!root || root.dataset.scrollBridgeBound === "1") return;
		root.dataset.scrollBridgeBound = "1";
		root.addEventListener("wheel", onWheel, { passive: false });
	};

	if (document.querySelector(ROOT_SELECTOR)) {
		attach();
	} else {
		document.addEventListener("DOMContentLoaded", attach, { once: true });
	}

	document.addEventListener("swup:contentReplaced", resetRails);
	document.addEventListener("astro:page-load", resetRails);
	window.addEventListener("popstate", resetRails);
}
