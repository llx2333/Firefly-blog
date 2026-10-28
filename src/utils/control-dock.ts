/**
 * 悬浮控制坞：折叠/展开、自由拖拽、左右停靠、位置持久化。
 *
 * 停靠模型（批18 用户拍板）：
 * - 拖动可以停在任意位置，松手不再弹回左/右边缘；
 * - 只有松手时离左/右边缘很近（SNAP_DISTANCE）才吸附停靠；
 * - 停靠态把半颗球收进屏幕外并降低不透明度；鼠标移入 / 键盘聚焦 / 展开时滑出到贴边可见；
 * - 所有位移与透明度变化都走缓动过渡，拖拽逐帧写入时关掉过渡避免拖影。
 *
 * FloatingControls 渲染在 Swup 容器之外、跨路由持久存在，所以这里只初始化一次；
 * 位置以「中心 ÷ 视口尺寸」的比例保存，窗口尺寸变化后仍落回相近位置。
 */

const STORAGE_KEY = "firefly:control-dock";
/** 沉浸阅读目录抽屉展开时，胶囊与抽屉边缘之间的间隙 */
const DRAWER_GAP = 12;
const DRAG_THRESHOLD = 4;
/** 胶囊边缘离视口左/右边缘小于这个距离时，吸附停靠（要小：稍远一点就自由摆放） */
const SNAP_DISTANCE = 10;
/** 停靠态收进屏幕外的球宽比例：0.5 = 藏起半颗 */
const TUCK_RATIO = 0.5;
/** 停靠态的不透明度 */
const TUCK_OPACITY = 0.55;
/** 与 CSS 里 .dock-settling 的过渡时长保持一致 */
const SETTLE_MS = 380;
const DEFAULT_X = 0;
const DEFAULT_Y = 0.64;
/** 这些按钮打开的是自身弹层，折叠胶囊会把弹层横向裁掉，点击后保持展开 */
const KEEP_OPEN_ACTIONS = new Set([
	"floating-toc-btn",
	"immersive-toc-toggle-btn",
]);

type DockSide = "left" | "right";

interface SavedPosition {
	/** 胶囊中心在视口宽度上的比例（0 = 左边缘，1 = 右边缘） */
	x: number;
	/** 胶囊中心在视口高度上的比例 */
	y: number;
	docked: DockSide | null;
}

interface DragState {
	pointerId: number;
	startX: number;
	startY: number;
	left: number;
	top: number;
	width: number;
	height: number;
	moved: boolean;
	/** 已显式捕获指针：拖出窗口后仍能收到 pointerup */
	captured: boolean;
}

declare global {
	interface Window {
		__controlDockInit?: boolean;
	}
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), Math.max(min, max));
}

function readSavedPosition(): SavedPosition | null {
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as {
			x?: unknown;
			y?: unknown;
			docked?: unknown;
			side?: unknown;
			ratio?: unknown;
		};

		if (typeof parsed.x === "number" && typeof parsed.y === "number") {
			const docked =
				parsed.docked === "left" || parsed.docked === "right"
					? parsed.docked
					: null;
			return {
				x: clamp(parsed.x, 0, 1),
				y: clamp(parsed.y, 0, 1),
				docked,
			};
		}

		// 批17 及更早的存档：{ side, ratio }，换算成新模型
		if (parsed.side === "left" || parsed.side === "right") {
			if (typeof parsed.ratio !== "number" || !Number.isFinite(parsed.ratio)) {
				return null;
			}
			return {
				x: parsed.side === "left" ? 0 : 1,
				y: clamp(parsed.ratio, 0, 1),
				docked: parsed.side,
			};
		}

		return null;
	} catch {
		return null;
	}
}

function writeSavedPosition(position: SavedPosition): void {
	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(position));
	} catch {
		// 隐私模式/配额已满：位置只在本次会话生效
	}
}

export function initControlDock(): void {
	if (window.__controlDockInit) return;

	const dock = document.getElementById("control-dock");
	const toggle = document.getElementById("control-dock-toggle");
	const items = document.getElementById("control-dock-items");
	if (!dock || !toggle) return;

	window.__controlDockInit = true;

	const saved = readSavedPosition();
	let posX = saved?.x ?? DEFAULT_X;
	let posY = saved?.y ?? DEFAULT_Y;
	let docked: DockSide | null = saved ? saved.docked : "left";
	/** 指针正悬停在胶囊上（或键盘聚焦）：停靠态下要滑出到贴边可见 */
	let hovered = false;
	/** 刚停靠时指针仍压在球上，忽略这次悬停，让它立刻收进半颗 */
	let hoverBlocked = false;
	let drag: DragState | null = null;
	let suppressClickUntil = 0;
	let settleTimer = 0;
	/** 当前 DOM 用的锚点；左右切换时先把新锚点写成当前视觉值，避免瞬移 */
	let anchor: "left" | "right" | null = null;

	/**
	 * 沉浸阅读的目录抽屉（#immersive-toc）是 fixed 全高面板，且渲染在胶囊内部，
	 * 层级上盖不过它——同侧时整枚胶囊会被挡住、点不到。抽屉展开时返回它的宽度，
	 * 让胶囊贴到抽屉内侧。
	 *
	 * 只取宽度、不取坐标：抽屉关闭态是 translateX(±100%) 滑出，开合过渡中
	 * 实时坐标是中间值，会算出错误锚点把胶囊埋回抽屉底下；宽度不受 transform
	 * 影响，左右位置由 body 的 immersive-toc-right 类确定。
	 */
	const drawerInset = (target: DockSide): number => {
		const body = document.body;
		if (!body.classList.contains("immersive-reading")) return 0;
		if (!body.classList.contains("immersive-toc-open")) return 0;
		const toc = document.getElementById("immersive-toc");
		if (!toc) return 0;
		const width = toc.getBoundingClientRect().width;
		if (width <= 0) return 0;
		const onRight = body.classList.contains("immersive-toc-right");
		if (target === "left" && !onRight) return width + DRAWER_GAP;
		if (target === "right" && onRight) return width + DRAWER_GAP;
		return 0;
	};

	const sizeOf = (): { width: number; height: number } => {
		const rect = dock.getBoundingClientRect();
		return { width: rect.width || 42, height: rect.height || 42 };
	};

	const isOpen = (): boolean => dock.dataset.open === "true";

	const withSettle = (animate: boolean): void => {
		if (!animate) {
			dock.classList.remove("dock-settling");
			return;
		}
		dock.classList.add("dock-settling");
		window.clearTimeout(settleTimer);
		settleTimer = window.setTimeout(() => {
			dock.classList.remove("dock-settling");
		}, SETTLE_MS + 80);
	};

	/**
	 * 写横向位置。左锚点用 left、右锚点用 right（宽度变化时右边缘不跑）。
	 * 锚点从一侧换到另一侧时，先把新锚点写成当前视觉位置并强制一次布局，
	 * 否则 auto → 数值无法参与过渡，停靠动画会变成瞬移。
	 */
	const commitPosition = (
		leftPx: number | null,
		rightPx: number | null,
		animate: boolean,
	): void => {
		const target: "left" | "right" = leftPx === null ? "right" : "left";
		if (anchor !== target) {
			const rect = dock.getBoundingClientRect();
			dock.classList.remove("dock-settling");
			if (target === "right") {
				dock.style.right = `${window.innerWidth - rect.right}px`;
				dock.style.left = "auto";
			} else {
				dock.style.left = `${rect.left}px`;
				dock.style.right = "auto";
			}
			// 强制布局：让起始值先落成当前视觉位置，再开始过渡
			void dock.offsetWidth;
		}
		withSettle(animate);
		if (leftPx === null) {
			dock.style.left = "auto";
			dock.style.right = `${rightPx ?? 0}px`;
		} else {
			dock.style.right = "auto";
			dock.style.left = `${leftPx}px`;
		}
		anchor = target;
	};

	/** 把当前状态落到 DOM：自由位置贴到比例坐标，停靠位置按收进/滑出取值 */
	const applyLayout = (animate: boolean): void => {
		const { width, height } = sizeOf();
		const viewportWidth = window.innerWidth;
		const viewportHeight = window.innerHeight;
		const maxLeft = Math.max(0, viewportWidth - width);
		const insetLeft = drawerInset("left");
		const insetRight = drawerInset("right");

		// 抽屉占住同侧时不能收进屏幕外，否则整颗球被压在抽屉底下
		const canTuck =
			docked === "left"
				? insetLeft === 0
				: docked === "right"
					? insetRight === 0
					: false;
		const tucked = docked !== null && canTuck && !hovered && !isOpen() && !drag;

		// 右停靠用 right 锚定：展开时宽度变大，右边缘必须钉住，否则会溢出屏幕
		let leftPx: number | null = null;
		let rightPx: number | null = null;
		if (docked === "left") {
			leftPx = tucked
				? -width * TUCK_RATIO
				: Math.max(Math.min(insetLeft, maxLeft), 0);
		} else if (docked === "right") {
			rightPx = tucked
				? -width * TUCK_RATIO
				: Math.max(Math.min(insetRight, viewportWidth - width), 0);
		} else {
			// 自由摆放：按球心所在半屏选锚点，展开时朝屏幕内侧生长
			const centerX = clamp(
				posX * viewportWidth,
				width / 2,
				viewportWidth - width / 2,
			);
			if (posX >= 0.5) {
				rightPx = Math.max(viewportWidth - centerX - width / 2, 0);
				rightPx = Math.max(
					rightPx,
					Math.min(insetRight, Math.max(0, viewportWidth - width)),
				);
			} else {
				leftPx = clamp(centerX - width / 2, 0, maxLeft);
				// 抽屉展开时把自由摆放的球也挪出抽屉覆盖区
				leftPx = clamp(
					leftPx,
					Math.min(insetLeft, maxLeft),
					maxLeft - insetRight,
				);
			}
		}

		const top = clamp(
			posY * viewportHeight - height / 2,
			0,
			viewportHeight - height,
		);

		commitPosition(leftPx, rightPx, animate);
		dock.style.top = `${top}px`;
		dock.style.opacity = tucked ? String(TUCK_OPACITY) : "1";
		dock.dataset.side = docked ?? (posX < 0.5 ? "left" : "right");
		dock.dataset.docked = docked ?? "";
		dock.dataset.tucked = String(tucked);
	};

	const persist = (): void => {
		writeSavedPosition({ x: posX, y: posY, docked });
	};

	const setOpen = (open: boolean): void => {
		if (!open) {
			// 先收起胶囊里的悬浮目录，否则折叠后它会被横向裁切
			const panel = document.getElementById("floating-toc-panel");
			if (panel?.classList.contains("show")) {
				const toggler = (
					window as unknown as { toggleFloatingTOC?: () => void }
				).toggleFloatingTOC;
				toggler?.();
			}
			dock.classList.remove("is-open-settled");
		}
		dock.dataset.open = String(open);
		toggle.setAttribute("aria-expanded", String(open));
		const label =
			(open ? toggle.dataset.labelOpen : toggle.dataset.labelClosed) ??
			toggle.getAttribute("aria-label") ??
			"";
		toggle.setAttribute("aria-label", label);
		toggle.setAttribute("title", label);
		// 展开要整枚露出，收起后重新按停靠态收回去
		applyLayout(true);
	};

	// 展开动画结束后才放开 overflow，否则按钮会先冒出胶囊再被裁切
	items?.addEventListener("transitionend", (event) => {
		const transition = event as TransitionEvent;
		if (
			transition.target !== items ||
			transition.propertyName !== "max-width"
		) {
			return;
		}
		dock.classList.toggle("is-open-settled", dock.dataset.open === "true");
	});

	const onPointerDown = (event: PointerEvent): void => {
		if (event.pointerType === "mouse" && event.button !== 0) return;
		const target = event.target as Element | null;
		// 展开态的按钮自己处理点击，不从按钮上起拖
		if (target?.closest(".floating-btn")) return;

		// 必须拦下默认行为：胶囊一开始移动，光标底下就换成了页面内容，
		// 浏览器会就地发起原生拖拽（图片/链接 dragstart 紧跟 pointercancel），
		// 拖拽序列当场作废、胶囊只走一帧（批15 实测）。
		event.preventDefault();

		// 停靠态先瞬间滑出到贴边可见，否则抓住的位置有一半在屏幕外
		if (docked) {
			hovered = true;
			dock.classList.remove("dock-settling");
			applyLayout(false);
		}

		const rect = dock.getBoundingClientRect();
		drag = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			left: rect.left,
			top: rect.top,
			width: rect.width,
			height: rect.height,
			moved: false,
			captured: false,
		};
	};

	const releaseCapture = (): void => {
		if (!drag?.captured) return;
		try {
			dock.releasePointerCapture(drag.pointerId);
		} catch {
			// 指针已经失效，无需释放
		}
		drag.captured = false;
	};

	/** 结束一次拖动：落点离边缘近就停靠，否则原地保留。pointerup / pointercancel / 失焦都走这里 */
	const endDrag = (): void => {
		if (!drag) return;
		const moved = drag.moved;
		releaseCapture();
		drag = null;
		dock.dataset.dragging = "false";
		if (!moved) return;

		// 拖拽结束浏览器仍会派发一次 click，短时间内吞掉它
		suppressClickUntil = Date.now() + 400;
		const rect = dock.getBoundingClientRect();
		const viewportWidth = window.innerWidth;
		const viewportHeight = window.innerHeight;
		const maxLeft = Math.max(0, viewportWidth - rect.width);

		posY = clamp((rect.top + rect.height / 2) / viewportHeight, 0, 1);
		if (rect.left <= SNAP_DISTANCE) {
			docked = "left";
			posX = 0;
		} else if (rect.left >= maxLeft - SNAP_DISTANCE) {
			docked = "right";
			posX = 1;
		} else {
			docked = null;
			posX = clamp((rect.left + rect.width / 2) / viewportWidth, 0, 1);
		}

		// 松手后指针还压在球上：忽略这次悬停，让它立刻收进半颗
		hovered = false;
		hoverBlocked = true;
		persist();
		applyLayout(true);
	};

	const onPointerMove = (event: PointerEvent): void => {
		if (!drag || event.pointerId !== drag.pointerId) return;
		const dx = event.clientX - drag.startX;
		const dy = event.clientY - drag.startY;
		if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
		if (!drag.moved) {
			drag.moved = true;
			dock.dataset.dragging = "true";
			// 逐帧写 left/top，过渡会造成拖影
			dock.classList.remove("dock-settling");
			// 显式捕获指针：光标拖出窗口后松开时仍能收到 pointerup，
			// 否则拖动态会卡住、胶囊停在贴边处不再吸附（批17）
			try {
				dock.setPointerCapture(drag.pointerId);
				drag.captured = true;
			} catch {
				// 指针已失效：靠 pointercancel / 失焦兜底
			}
		}

		const viewportWidth = window.innerWidth;
		const viewportHeight = window.innerHeight;
		const left = clamp(drag.left + dx, 0, viewportWidth - drag.width);
		const top = clamp(drag.top + dy, 0, viewportHeight - drag.height);

		dock.style.left = `${left}px`;
		dock.style.right = "auto";
		dock.style.top = `${top}px`;
		dock.style.opacity = "1";
		anchor = "left";
	};

	const onPointerUp = (event: PointerEvent): void => {
		if (!drag || event.pointerId !== drag.pointerId) return;
		endDrag();
	};

	const onPointerEnter = (): void => {
		if (drag || hoverBlocked || !docked) return;
		hovered = true;
		applyLayout(true);
	};

	const onPointerLeave = (): void => {
		hoverBlocked = false;
		if (drag || !docked) return;
		hovered = false;
		applyLayout(true);
	};

	const onFocusIn = (): void => {
		if (drag || !docked) return;
		hovered = true;
		applyLayout(true);
	};

	const onFocusOut = (event: FocusEvent): void => {
		if (drag || !docked) return;
		const next = event.relatedTarget;
		if (next instanceof Node && dock.contains(next)) return;
		hovered = false;
		applyLayout(true);
	};

	const onClick = (event: MouseEvent): void => {
		const target = event.target as Element | null;
		if (!target) return;

		if (target.closest("#control-dock-toggle")) {
			if (Date.now() < suppressClickUntil) return;
			setOpen(dock.dataset.open !== "true");
			return;
		}

		const action = target.closest(".floating-btn");
		if (!action || dock.dataset.open !== "true") return;
		if (KEEP_OPEN_ACTIONS.has(action.id)) return;
		window.setTimeout(() => setOpen(false), 160);
	};

	dock.addEventListener("pointerdown", onPointerDown);
	window.addEventListener("pointermove", onPointerMove);
	window.addEventListener("pointerup", onPointerUp);
	window.addEventListener("pointercancel", onPointerUp);
	dock.addEventListener("pointerenter", onPointerEnter);
	dock.addEventListener("pointerleave", onPointerLeave);
	dock.addEventListener("focusin", onFocusIn);
	dock.addEventListener("focusout", onFocusOut);
	// 拖到窗口外松手、切标签页：浏览器不再派发 pointerup，靠这两个事件收尾
	window.addEventListener("blur", endDrag);
	document.addEventListener("visibilitychange", () => {
		if (document.hidden) endDrag();
	});
	dock.addEventListener("click", onClick);

	// 展开时点外部/按 Esc 收起
	document.addEventListener(
		"pointerdown",
		(event) => {
			if (dock.dataset.open !== "true") return;
			const target = event.target as Node | null;
			if (target && dock.contains(target)) return;
			setOpen(false);
		},
		true,
	);
	document.addEventListener("keydown", (event) => {
		if (event.key === "Escape" && dock.dataset.open === "true") {
			setOpen(false);
		}
	});

	let resizeTimer = 0;
	window.addEventListener("resize", () => {
		window.clearTimeout(resizeTimer);
		resizeTimer = window.setTimeout(() => applyLayout(false), 120);
	});

	// 进出沉浸阅读、抽屉开合都只改 body 的 class：靠它把胶囊让到抽屉内侧，
	// 再原路退回。拖拽中不打断。
	if (typeof MutationObserver !== "undefined") {
		new MutationObserver(() => {
			if (!drag) applyLayout(true);
		}).observe(document.body, { attributes: true, attributeFilter: ["class"] });
	}

	applyLayout(false);
}
