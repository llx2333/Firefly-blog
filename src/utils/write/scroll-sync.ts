/**
 * P2：编辑 ↔ 预览按比例滚动同步（VSCode 式，比例算法同 Joplin sync_scroll 标准）。
 *
 * 双窗态下两侧各是一个内部滚动容器：编辑侧 = CM6 scroller，预览侧 = 预览卡。
 * 同步按比例 p = scrollTop / (scrollHeight - clientHeight) 双向应用，与两侧
 * 内容高度差异无关（文档说清：不按行号对齐，按可视比例对齐——用户拍板口径）。
 *
 * 防振荡两件套：
 * - 回声按值匹配：程序改写对侧 scrollTop 后，若对侧随后到来的 scroll 事件位置
 *   恰好等于我们写入的值，判为回声吞掉，绝不回采（否则两侧互相触发、指数级抖动）；
 *   位置不同则是真实滚动（含脚本快速交替），照常同步——比「吞下一条事件」的
 *   粗粒度守卫更稳，不会误吞 120ms 窗口内的合法滚动。
 * - 兜底定时器：目标位置恰好等于当前值时浏览器不发 scroll 事件，回声等不到，
 *   120ms 后清除待定回声，防止误判卡死。
 * - rAF 合帧：连续滚动一帧只算一次，丢掉中间态。
 *
 * 只在「双窗态且两侧卡都可见」时生效（enabled 回调由组件按布局态传入）；
 * 单预览态预览卡回归页面级滚动，单编辑态对侧隐藏，守卫照旧安全空转。
 */

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

/** 单侧滚动比例；不可滚（内容不满一屏）返回 null，调用方跳过本次同步 */
function scrollFraction(el: HTMLElement): number | null {
	const max = el.scrollHeight - el.clientHeight;
	return max > 0 ? el.scrollTop / max : null;
}

export function createScrollSync(
	source: HTMLElement,
	target: HTMLElement,
	options: ScrollSyncOptions = {},
): ScrollSyncHandle {
	let enabledFn = options.enabled ?? (() => true);
	const echoFallbackMs = options.echoFallbackMs ?? 120;
	/** 刚写入对侧的 scrollTop 值（按值匹配回声，而非盲吞下一条事件） */
	let pendingEcho: { el: HTMLElement; value: number } | null = null;
	let echoTimer = 0;
	/** 每个方向独立 rAF 槽位：同帧两侧都有事件时两个方向的同步都执行
	 *（CM6 measure 会在程序滚动后微调 scroller scrollTop，再发一次 scroll 事件——
	 * 若跨方向互吃 rAF，pv 的合法滚动会被 ed 的锚定微调事件顶掉，同步丢失） */
	let rafSource = 0;
	let rafTarget = 0;

	const isVisible = (el: HTMLElement) => el.offsetParent !== null;

	function clearEcho() {
		pendingEcho = null;
		clearTimeout(echoTimer);
	}

	function apply(from: HTMLElement, to: HTMLElement) {
		if (!enabledFn()) return;
		// 任一侧当前不可见（隐藏卡 / 手机单卡）时不同步，防止对隐藏元素写 scrollTop
		if (isVisible(from) === false || isVisible(to) === false) return;
		const p = scrollFraction(from);
		if (p === null) return;
		const toMax = to.scrollHeight - to.clientHeight;
		// 对侧不可滚：没有可映射的距离，跳过（宁缺勿错，不硬拉到 0）
		if (toMax <= 0) return;
		const value = Math.round(p * toMax);
		pendingEcho = { el: to, value };
		clearTimeout(echoTimer);
		echoTimer = window.setTimeout(() => {
			pendingEcho = null;
		}, echoFallbackMs);
		if (to.scrollTop !== value) to.scrollTop = value;
		else clearEcho(); // 位置不变不会来事件，回声当场结清
	}

	function handle(
		el: HTMLElement,
		from: HTMLElement,
		to: HTMLElement,
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
					apply(from, to);
				}),
			);
		};
	}

	const onSourceScroll = handle(
		source,
		source,
		target,
		() => rafSource,
		(v) => {
			rafSource = v;
		},
	);
	const onTargetScroll = handle(
		target,
		target,
		source,
		() => rafTarget,
		(v) => {
			rafTarget = v;
		},
	);
	source.addEventListener("scroll", onSourceScroll, { passive: true });
	target.addEventListener("scroll", onTargetScroll, { passive: true });

	return {
		setEnabled(enabled: boolean) {
			enabledFn = () => enabled;
		},
		destroy() {
			source.removeEventListener("scroll", onSourceScroll);
			target.removeEventListener("scroll", onTargetScroll);
			if (rafSource) cancelAnimationFrame(rafSource);
			if (rafTarget) cancelAnimationFrame(rafTarget);
			clearTimeout(echoTimer);
		},
	};
}
