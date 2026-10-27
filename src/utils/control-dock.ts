/**
 * 悬浮控制坞：折叠/展开、拖拽、左右贴边吸附、位置持久化。
 *
 * FloatingControls 渲染在 Swup 容器之外、跨路由持久存在，所以这里只初始化一次；
 * 位置以「顶端 ÷ 视口高度」的比例保存，窗口尺寸变化后仍落回相近位置。
 * 吸附动画走 margin 而不是 transform：胶囊内部的沉浸阅读目录是 position:fixed，
 * 祖先一旦带 transform 就会变成它的包含块，抽屉会缩到胶囊里。
 */

const STORAGE_KEY = "firefly:control-dock";
const EDGE_GAP = 14;
/** 沉浸阅读目录抽屉展开时，胶囊与抽屉边缘之间的间隙 */
const DRAWER_GAP = 12;
const DRAG_THRESHOLD = 4;
const DEFAULT_RATIO = 0.64;
/** 这些按钮打开的是自身弹层，折叠胶囊会把弹层横向裁掉，点击后保持展开 */
const KEEP_OPEN_ACTIONS = new Set([
	"floating-toc-btn",
	"immersive-toc-toggle-btn",
]);

type DockSide = "left" | "right";

interface SavedPosition {
	side: DockSide;
	ratio: number;
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
		const parsed = JSON.parse(raw) as Partial<SavedPosition>;
		if (parsed.side !== "left" && parsed.side !== "right") return null;
		if (typeof parsed.ratio !== "number" || !Number.isFinite(parsed.ratio)) {
			return null;
		}
		return { side: parsed.side, ratio: clamp(parsed.ratio, 0, 1) };
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
	let side: DockSide = saved?.side ?? "left";
	let ratio = saved?.ratio ?? DEFAULT_RATIO;
	let drag: DragState | null = null;
	let suppressClickUntil = 0;

	const hints = Array.from(
		document.querySelectorAll<HTMLElement>(".dock-snap-hint"),
	);

	const setHint = (edge: DockSide | null): void => {
		for (const hint of hints) {
			hint.dataset.active = String(hint.dataset.edge === edge);
		}
	};

	/**
	 * 沉浸阅读的目录抽屉（#immersive-toc）是 fixed 全高面板，且渲染在胶囊内部，
	 * 层级上盖不过它——同侧时整枚胶囊会被挡住、点不到。抽屉展开时返回它的宽度，
	 * 让胶囊贴到抽屉内侧。
	 *
	 * 只取宽度、不取坐标：抽屉关闭态是 translateX(±100%) 滑出，开合过渡中
	 * 实时坐标是中间值，会算出错误锚点把胶囊埋回抽屉底下；宽度不受 transform
	 * 影响，左右位置由 body 的 immersive-toc-right 类确定。
	 */
	const drawerWidth = (): { width: number; onRight: boolean } | null => {
		const body = document.body;
		if (!body.classList.contains("immersive-reading")) return null;
		if (!body.classList.contains("immersive-toc-open")) return null;
		const toc = document.getElementById("immersive-toc");
		if (!toc) return null;
		const width = toc.getBoundingClientRect().width;
		if (width <= 0) return null;
		return { width, onRight: body.classList.contains("immersive-toc-right") };
	};

	/** 停靠到某一侧时，胶囊真正的锚点坐标：left 侧是左边缘，right 侧是右边缘 */
	const anchorPx = (target: DockSide): number => {
		const drawer = drawerWidth();
		if (drawer) {
			if (target === "left" && !drawer.onRight) {
				return drawer.width + DRAWER_GAP;
			}
			if (target === "right" && drawer.onRight) {
				return window.innerWidth - drawer.width - DRAWER_GAP;
			}
		}
		return target === "left" ? EDGE_GAP : window.innerWidth - EDGE_GAP;
	};

	const place = (animate = false): void => {
		if (animate) {
			dock.classList.add("dock-sliding");
			window.setTimeout(() => dock.classList.remove("dock-sliding"), 360);
		}
		const height = dock.getBoundingClientRect().height || 52;
		const viewportHeight = window.innerHeight;
		const top = clamp(
			ratio * viewportHeight,
			EDGE_GAP,
			viewportHeight - height - EDGE_GAP,
		);
		dock.style.top = `${top}px`;
		dock.style.left = side === "left" ? `${anchorPx("left")}px` : "auto";
		dock.style.right =
			side === "right" ? `${window.innerWidth - anchorPx("right")}px` : "auto";
		dock.style.marginLeft = "0px";
		dock.style.marginRight = "0px";
		dock.dataset.side = side;
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

	const snapTo = (nextSide: DockSide): void => {
		const rect = dock.getBoundingClientRect();
		const target = anchorPx(nextSide);
		// 指向「胶囊被摆到贴边位置后，需要往外偏移多少才能保持当前视觉位置」
		const offset =
			nextSide === "left" ? rect.left - target : target - rect.right;

		side = nextSide;
		dock.dataset.side = side;
		dock.style.left = side === "left" ? `${target}px` : "auto";
		dock.style.right =
			side === "right" ? `${window.innerWidth - target}px` : "auto";
		dock.style.marginLeft = side === "left" ? `${offset}px` : "0px";
		dock.style.marginRight = side === "right" ? `${offset}px` : "0px";

		// 强制一次布局，让「贴边 + 反向 margin」先落成拖拽终点，再开始吸附过渡
		dock.getBoundingClientRect();
		window.requestAnimationFrame(() => {
			dock.style.marginLeft = "0px";
			dock.style.marginRight = "0px";
		});

		writeSavedPosition({ side, ratio });
	};

	const onPointerDown = (event: PointerEvent): void => {
		if (event.pointerType === "mouse" && event.button !== 0) return;
		const target = event.target as Element | null;
		// 展开态的按钮自己处理点击，不从按钮上起拖
		if (target?.closest(".floating-btn")) return;

		// 必须拦下默认行为：胶囊一开始移动，光标底下就换成了页面内容，
		// 浏览器会就地发起原生拖拽（图片/链接 dragstart 紧跟 pointercancel），
		// 拖拽序列当场作废、胶囊只走一帧（批15 实测）。
		event.preventDefault();

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
		};
	};

	const onPointerMove = (event: PointerEvent): void => {
		if (!drag || event.pointerId !== drag.pointerId) return;
		const dx = event.clientX - drag.startX;
		const dy = event.clientY - drag.startY;
		if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
		if (!drag.moved) {
			drag.moved = true;
			dock.dataset.dragging = "true";
		}

		const viewportWidth = window.innerWidth;
		const viewportHeight = window.innerHeight;
		const left = clamp(drag.left + dx, 0, viewportWidth - drag.width);
		const top = clamp(drag.top + dy, 0, viewportHeight - drag.height);
		dock.style.left = `${left}px`;
		dock.style.right = "auto";
		dock.style.top = `${top}px`;
		setHint(left + drag.width / 2 < viewportWidth / 2 ? "left" : "right");
	};

	const onPointerUp = (event: PointerEvent): void => {
		if (!drag || event.pointerId !== drag.pointerId) return;
		const moved = drag.moved;
		drag = null;
		dock.dataset.dragging = "false";
		setHint(null);
		if (!moved) return;

		// 拖拽结束浏览器仍会派发一次 click，短时间内吞掉它
		suppressClickUntil = Date.now() + 400;
		const rect = dock.getBoundingClientRect();
		ratio = clamp(rect.top / window.innerHeight, 0, 1);
		snapTo(
			rect.left + rect.width / 2 < window.innerWidth / 2 ? "left" : "right",
		);
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
		resizeTimer = window.setTimeout(place, 120);
	});

	// 进出沉浸阅读、抽屉开合都只改 body 的 class：靠它把胶囊让到抽屉内侧，
	// 再原路退回。拖拽中不打断。
	if (typeof MutationObserver !== "undefined") {
		new MutationObserver(() => {
			if (!drag) place(true);
		}).observe(document.body, { attributes: true, attributeFilter: ["class"] });
	}

	place();
	if (saved) {
		// 恢复过的位置直接落位，不播放吸附过渡
		dock.style.marginLeft = "0px";
		dock.style.marginRight = "0px";
	}
}
