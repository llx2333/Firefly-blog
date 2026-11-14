import {
	DARK_MODE,
	DEFAULT_THEME,
	LIGHT_MODE,
	SYSTEM_MODE,
	WALLPAPER_BANNER,
	WALLPAPER_FULLSCREEN,
	WALLPAPER_NONE,
	WALLPAPER_OVERLAY,
} from "@constants/constants";
import type {
	FullscreenWallpaperLayout,
	LIGHT_DARK_MODE,
	WALLPAPER_MODE,
} from "@/types/config";
import type { AmbientEffectId } from "@/types/effectsConfig";
import {
	ambientEffectsConfig,
	backgroundWallpaper,
	displaySettingsConfig,
	expressiveCodeConfig,
	siteConfig,
} from "../config";
import { isHomePage as checkIsHomePage } from "./layout-utils";

// Declare global functions
declare global {
	interface Window {
		initSemifullScrollDetection?: () => void;
		semifullScrollHandler?: () => void;
	}
}

// ===== 主题域存储加固（批23）：ff2. 前缀 + 一次性迁移 + 坏值校验 + 诊断埋点 =====
// 主题域键统一走 ff2. 前缀；首次读到新键缺失而旧键存在 → 值合法则迁入新键并删除旧键，
// 值非法则直接删旧键用默认。禁改键（music-player-volume、控制坞位置键、write-editor-*）不在此列。
export const FF2_PREFIX = "ff2.";

const THEME_STORAGE_KEYS = [
	"hue",
	"theme",
	"wallpaperSet",
	"wallpaperMode",
	"fullscreenLayout",
	"overlayOpacity",
	"overlayBlur",
	"overlayCardOpacity",
	"wavesEnabled",
	"gradientEnabled",
	"bannerTitleEnabled",
	"bannerCarouselEnabled",
	"cardBorderEnabled",
	"cardFollowThemeEnabled",
	"postListLayout",
	"ambientEffects",
] as const;

type ThemeStorageKey = (typeof THEME_STORAGE_KEYS)[number];

function ff2Key(key: ThemeStorageKey): string {
	return FF2_PREFIX + key;
}

// hue 必须为有限数字且 0–360（历史粉值/坏值防线）
function isValidHueValue(value: string): boolean {
	if (!/^-?\d+(\.\d+)?$/.test(value.trim())) {
		return false;
	}
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed >= 0 && parsed <= 360;
}

// 各键合法性校验（迁移与坏值清理共用）
function isValidThemeValue(key: ThemeStorageKey, value: string): boolean {
	switch (key) {
		case "hue":
			return isValidHueValue(value);
		case "theme":
			return value === "light" || value === "dark" || value === "system";
		case "wallpaperSet":
			return value === "main" || value === "alt";
		case "wallpaperMode":
			return (
				value === "banner" ||
				value === "fullscreen" ||
				value === "overlay" ||
				value === "none"
			);
		case "fullscreenLayout":
			return value === "hero" || value === "classic";
		case "postListLayout":
			return value === "list" || value === "grid";
		case "overlayOpacity":
		case "overlayCardOpacity": {
			const parsed = Number.parseFloat(value);
			return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1;
		}
		case "overlayBlur": {
			const parsed = Number.parseFloat(value);
			return Number.isFinite(parsed) && parsed >= 0 && parsed <= 20;
		}
		case "wavesEnabled":
		case "gradientEnabled":
		case "bannerTitleEnabled":
		case "bannerCarouselEnabled":
		case "cardBorderEnabled":
		case "cardFollowThemeEnabled":
			return value === "true" || value === "false";
		case "ambientEffects": {
			try {
				const parsed: unknown = JSON.parse(value);
				return (
					typeof parsed === "object" &&
					parsed !== null &&
					!Array.isArray(parsed)
				);
			} catch {
				return false;
			}
		}
		default:
			return false;
	}
}

// ===== P4 诊断埋点：环形缓冲 localStorage['ff2.diag']（JSON，最多 20 条），失败静默 =====
type DiagEntry = {
	t: string;
	ev: string;
	key?: string;
	old?: string | null;
	new?: string | null;
	src?: string;
};

const FF2_DIAG_KEY = "ff2.diag";
const FF2_DIAG_MAX = 20;

function recordDiag(entry: Omit<DiagEntry, "t">): void {
	try {
		if (typeof window === "undefined" || !window.localStorage) {
			return;
		}
		const full: DiagEntry = { t: new Date().toISOString(), ...entry };
		const raw = localStorage.getItem(FF2_DIAG_KEY);
		let list: DiagEntry[] = [];
		if (raw) {
			const parsed: unknown = JSON.parse(raw);
			if (Array.isArray(parsed)) {
				list = parsed as DiagEntry[];
			}
		}
		list.push(full);
		if (list.length > FF2_DIAG_MAX) {
			list = list.slice(-FF2_DIAG_MAX);
		}
		localStorage.setItem(FF2_DIAG_KEY, JSON.stringify(list));
		console.warn("[ff-diag]", full.ev, full.key ?? "", full);
	} catch {
		// 诊断失败静默，不影响功能
	}
}

// ===== 旧键迁移白名单（批23 V1：污染值不得经迁移复活）=====
// hue：仅历史/现行默认色相（150=现行默认，165=历史默认，及当前配置值）可迁入；
// 其余（如症状中的粉值 345）一律按坏值清理。wallpaperSet：仅 'main' 迁入，
// 'alt'（症状中的「整个皮肤变回流萤」污染态）静默删除，用户可在面板重选。
// 其余键按结构合法性迁入。运行时 ff2.* 校验不受此白名单影响（仍按各键结构规则）。
const MIGRATABLE_LEGACY_HUES = new Set(["150", "165"]);

function isMigratableLegacyHue(value: string): boolean {
	const trimmed = value.trim();
	if (!isValidHueValue(trimmed)) {
		return false;
	}
	if (MIGRATABLE_LEGACY_HUES.has(trimmed)) {
		return true;
	}
	return trimmed === String(getDefaultHue());
}

function isMigratableValue(key: ThemeStorageKey, value: string): boolean {
	if (key === "hue") {
		return isMigratableLegacyHue(value);
	}
	if (key === "wallpaperSet") {
		return value === "main";
	}
	return isValidThemeValue(key, value);
}

// 一次性迁移：旧裸键 → ff2. 新键（白名单值迁入、其余删除；新键已存在时旧键直接删除）
export function migrateLegacyThemeKeys(src = "init"): void {
	if (typeof window === "undefined" || !window.localStorage) {
		return;
	}
	try {
		for (const key of THEME_STORAGE_KEYS) {
			const legacy = localStorage.getItem(key);
			if (legacy === null) {
				continue;
			}
			const newKey = ff2Key(key);
			const migratable = isMigratableValue(key, legacy);
			if (localStorage.getItem(newKey) === null && migratable) {
				localStorage.setItem(newKey, legacy);
				recordDiag({
					ev: "migrate",
					key,
					old: legacy,
					new: legacy,
					src,
				});
			} else if (key === "hue" && !migratable) {
				recordDiag({
					ev: "bad-hue",
					key,
					old: legacy,
					new: null,
					src: `migrate:${src}`,
				});
			}
			localStorage.removeItem(key);
		}
	} catch {
		// 迁移失败静默，读取路径另有兜底
	}
}

// 裸键读 helper：优先 ff2. 新键，缺失时兜底读旧键（供 inline 脚本之外的直接读点复用）
export function ff2GetRaw(key: ThemeStorageKey): string | null {
	if (typeof window === "undefined" || !window.localStorage) {
		return null;
	}
	try {
		const stored = localStorage.getItem(ff2Key(key));
		if (stored !== null) {
			return stored;
		}
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

// 裸键写 helper：写 ff2. 新键
export function ff2SetRaw(key: ThemeStorageKey, value: string): void {
	if (typeof window === "undefined" || !window.localStorage) {
		return;
	}
	try {
		localStorage.setItem(ff2Key(key), value);
	} catch {
		// 写失败静默
	}
}

// 裸键删 helper：新旧键一并删除
export function ff2RemoveRaw(key: ThemeStorageKey): void {
	if (typeof window === "undefined" || !window.localStorage) {
		return;
	}
	try {
		localStorage.removeItem(ff2Key(key));
		localStorage.removeItem(key);
	} catch {
		// 删除失败静默
	}
}

// 诊断监听器只装一次：跨标签页 storage 事件 + 模块加载期兜底迁移
let themeDiagnosticsInstalled = false;
function ensureThemeDiagnostics(): void {
	if (themeDiagnosticsInstalled) {
		return;
	}
	if (typeof window === "undefined" || !window.localStorage) {
		return;
	}
	themeDiagnosticsInstalled = true;
	migrateLegacyThemeKeys("module-init");
	try {
		window.addEventListener("storage", (e: StorageEvent) => {
			if (!e.key?.startsWith(FF2_PREFIX)) {
				return;
			}
			recordDiag({
				ev: "storage-event",
				key: e.key,
				old: e.oldValue,
				new: e.newValue,
				src: "cross-tab",
			});
		});
	} catch {
		// 监听器安装失败静默
	}
}

export function getDefaultHue(): number {
	const fallback = "250";
	// 检查是否在浏览器环境中
	if (typeof document === "undefined") {
		return Number.parseInt(fallback, 10);
	}
	const configCarrier = document.getElementById("config-carrier");
	return Number.parseInt(configCarrier?.dataset.hue || fallback, 10);
}

export function getDefaultTheme(): LIGHT_DARK_MODE {
	// 如果配置文件中设置了 defaultMode，使用配置的值
	// 否则使用 DEFAULT_THEME（向后兼容）
	return siteConfig.themeColor.defaultMode ?? DEFAULT_THEME;
}

// 获取系统主题
export function getSystemTheme(): LIGHT_DARK_MODE {
	if (typeof window === "undefined") {
		return LIGHT_MODE;
	}
	return window.matchMedia("(prefers-color-scheme: dark)").matches
		? DARK_MODE
		: LIGHT_MODE;
}

// 解析主题（如果是system模式，则获取系统主题）
export function resolveTheme(theme: LIGHT_DARK_MODE): LIGHT_DARK_MODE {
	if (theme === SYSTEM_MODE) {
		return getSystemTheme();
	}
	return theme;
}

export function getHue(): number {
	// 先检查全局对象
	if (typeof window === "undefined" || !window.localStorage) {
		return getDefaultHue();
	}
	try {
		// 新键：ff2.hue（坏值清理 + 诊断）
		const stored = localStorage.getItem(ff2Key("hue"));
		if (stored !== null) {
			if (isValidHueValue(stored)) {
				return Number(stored);
			}
			localStorage.removeItem(ff2Key("hue"));
			recordDiag({
				ev: "bad-hue",
				key: ff2Key("hue"),
				old: stored,
				new: null,
				src: "getHue",
			});
			return getDefaultHue();
		}
		// 新键缺失：旧裸键兜底（含迁移；白名单外/非法值直接删除用默认）
		const legacy = localStorage.getItem("hue");
		if (legacy !== null) {
			if (isMigratableLegacyHue(legacy)) {
				localStorage.setItem(ff2Key("hue"), legacy);
				recordDiag({
					ev: "migrate",
					key: "hue",
					old: legacy,
					new: legacy,
					src: "getHue",
				});
				localStorage.removeItem("hue");
				return Number(legacy);
			}
			localStorage.removeItem("hue");
			recordDiag({
				ev: "bad-hue",
				key: "hue",
				old: legacy,
				new: null,
				src: "getHue-legacy",
			});
			return getDefaultHue();
		}
	} catch {
		// 存储访问失败回退默认
	}
	return getDefaultHue();
}

export function setHue(
	hue: number,
	source: "slider" | "reset" | "program" = "program",
): void {
	// 先检查是否在浏览器环境
	if (
		typeof window === "undefined" ||
		!window.localStorage ||
		typeof document === "undefined"
	) {
		return;
	}
	// 非法入参直接拒绝（不写存储、不改样式）
	if (!Number.isFinite(hue) || hue < 0 || hue > 360) {
		recordDiag({
			ev: "bad-hue",
			key: ff2Key("hue"),
			old: null,
			new: String(hue),
			src: `setHue:${source} rejected`,
		});
		return;
	}
	let previous: string | null = null;
	try {
		previous = localStorage.getItem(ff2Key("hue"));
	} catch {
		previous = null;
	}
	localStorage.setItem(ff2Key("hue"), String(hue));
	const r = document.querySelector(":root") as HTMLElement;
	if (r) {
		r.style.setProperty("--hue", String(hue));
	}
	// 诊断：set-hue（来源标签 + 栈前三行摘要 + 面板开合 + 同步 lastHue 快照）
	try {
		const stack = new Error().stack ?? "";
		const stackSummary = stack
			.split("\n")
			.slice(1, 4)
			.map((line) => line.trim())
			.join(" <- ");
		const panel = document.getElementById("display-setting");
		const panelState = !panel
			? "absent"
			: panel.classList.contains("float-panel-closed")
				? "closed"
				: "open";
		recordDiag({
			ev: "set-hue",
			key: ff2Key("hue"),
			old: previous,
			new: String(hue),
			src: `${source} panel=${panelState} ${stackSummary}`.slice(0, 200),
		});
		localStorage.setItem("ff2.lastHue", String(hue));
	} catch {
		// 诊断失败静默
	}
}

export function applyThemeToDocument(theme: LIGHT_DARK_MODE): void {
	// 检查是否在浏览器环境中
	if (typeof document === "undefined") {
		return;
	}

	// 解析主题
	const resolvedTheme = resolveTheme(theme);

	// 获取当前主题状态的完整信息
	const currentIsDark = document.documentElement.classList.contains("dark");
	const currentTheme = document.documentElement.getAttribute("data-theme");

	// 计算目标主题状态
	let targetIsDark = false; // 初始化默认值
	switch (resolvedTheme) {
		case LIGHT_MODE:
			targetIsDark = false;
			break;
		case DARK_MODE:
			targetIsDark = true;
			break;
		default:
			// 处理默认情况，使用当前主题状态
			targetIsDark = currentIsDark;
			break;
	}

	// 检测是否真的需要主题切换：
	// 1. dark类状态是否改变
	// 2. expressiveCode主题是否需要更新
	const needsThemeChange = currentIsDark !== targetIsDark;
	const expectedTheme = targetIsDark
		? expressiveCodeConfig.darkTheme
		: expressiveCodeConfig.lightTheme;
	const needsCodeThemeUpdate = currentTheme !== expectedTheme;

	// 如果既不需要主题切换也不需要代码主题更新，直接返回
	if (!needsThemeChange && !needsCodeThemeUpdate) {
		return;
	}

	// 批量 DOM 操作，减少重绘
	if (needsThemeChange) {
		// 添加过渡保护类（但会导致大量重绘，所以使用更轻量的方式）
		// document.documentElement.classList.add("is-theme-transitioning");

		// 直接切换主题，利用 CSS 变量的特性让浏览器优化过渡
		if (targetIsDark) {
			document.documentElement.classList.add("dark");
		} else {
			document.documentElement.classList.remove("dark");
		}
	}

	// Set the theme for Expressive Code based on current mode
	if (needsCodeThemeUpdate) {
		document.documentElement.setAttribute("data-theme", expectedTheme);
	}
}

// 系统主题监听器引用
let systemThemeListener:
	| ((e: MediaQueryListEvent | MediaQueryList) => void)
	| null = null;

export function setTheme(theme: LIGHT_DARK_MODE): void {
	// 检查是否在浏览器环境中
	if (
		typeof localStorage === "undefined" ||
		typeof localStorage.setItem !== "function"
	) {
		return;
	}

	// 先应用主题
	applyThemeToDocument(theme);

	// 保存到localStorage
	ff2SetRaw("theme", theme);

	// 如果切换到 system 模式，需要监听系统主题变化
	if (theme === SYSTEM_MODE) {
		setupSystemThemeListener();
	} else {
		// 如果切换其他模式，移除系统主题监听
		cleanupSystemThemeListener();
	}
}

// 设置系统主题监听器
export function setupSystemThemeListener(): void {
	// 先清理之前的监听器
	cleanupSystemThemeListener();

	if (typeof window === "undefined") {
		return;
	}

	const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

	// 处理系统主题变化的回调
	const handleSystemThemeChange = (e: MediaQueryListEvent | MediaQueryList) => {
		const isDark = e.matches;
		const currentIsDark = document.documentElement.classList.contains("dark");

		// 如果主题状态没有变化，直接返回
		if (currentIsDark === isDark) {
			return;
		}

		// 直接应用系统主题，不使用过渡保护类以避免大量重绘
		if (isDark) {
			document.documentElement.classList.add("dark");
		} else {
			document.documentElement.classList.remove("dark");
		}

		// Set the theme for Expressive Code
		const expressiveTheme = isDark
			? expressiveCodeConfig.darkTheme
			: expressiveCodeConfig.lightTheme;
		document.documentElement.setAttribute("data-theme", expressiveTheme);

		// 触发自定义事件通知其他组件（仅在真正切换时触发）
		window.dispatchEvent(new CustomEvent("theme-change"));
	};

	// 立即调用一次以设置初始状态
	handleSystemThemeChange(mediaQuery);

	// 监听系统主题变化（现代浏览器）
	if (mediaQuery.addEventListener) {
		mediaQuery.addEventListener("change", handleSystemThemeChange);
	} else {
		// 兼容旧浏览器
		mediaQuery.addListener(handleSystemThemeChange);
	}

	systemThemeListener = handleSystemThemeChange;
}

// 清理系统主题监听器
function cleanupSystemThemeListener() {
	if (typeof window === "undefined" || !systemThemeListener) {
		return;
	}

	const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

	if (mediaQuery.removeEventListener) {
		mediaQuery.removeEventListener("change", systemThemeListener);
	} else {
		// 兼容旧浏览器
		mediaQuery.removeListener(systemThemeListener);
	}

	systemThemeListener = null;
}

export function getStoredTheme(): LIGHT_DARK_MODE {
	// 检查是否在浏览器环境中
	if (
		typeof localStorage === "undefined" ||
		typeof localStorage.getItem !== "function"
	) {
		return getDefaultTheme();
	}
	return (ff2GetRaw("theme") as LIGHT_DARK_MODE | null) || getDefaultTheme();
}

// 初始化主题监听器（用于页面加载后）
export function initThemeListener(): void {
	ensureThemeDiagnostics();
	if (
		typeof localStorage === "undefined" ||
		typeof localStorage.getItem !== "function"
	) {
		return;
	}

	const theme = getStoredTheme();

	// 如果主题是 system 模式，需要监听系统主题变化
	if (theme === SYSTEM_MODE) {
		setupSystemThemeListener();
	}
}

// Wallpaper mode functions

/**
 * 同步首页标题显示（hidden 类）：首页 + banner/fullscreen 模式显示标题，其余情况隐藏。
 * SSR 按 config 默认模式渲染 hidden（默认 overlay/none 时带 hidden），而模式可运行时切换、
 * 页面也会经 Swup 切换（body.is-home 变化），因此需要按当前 mode + 是否首页重新计算。
 * 标题开关（user-hidden 类）独立控制，不受影响。
 */
export function syncBannerHomeTextVisibility(): void {
	const overlay = document.querySelector(
		".banner-home-text-overlay",
	) as HTMLElement | null;
	if (!overlay) return;
	const mode = document.documentElement.getAttribute("data-wallpaper-mode");
	const isHome = checkIsHomePage(window.location.pathname);
	const show =
		isHome && (mode === WALLPAPER_BANNER || mode === WALLPAPER_FULLSCREEN);
	overlay.classList.toggle("hidden", !show);
}

export function getDefaultFullscreenLayout(): FullscreenWallpaperLayout {
	return backgroundWallpaper.fullscreen?.layout ?? "classic";
}

export function getStoredFullscreenLayout(): FullscreenWallpaperLayout {
	const defaultLayout = getDefaultFullscreenLayout();
	if (
		typeof localStorage === "undefined" ||
		typeof localStorage.getItem !== "function"
	) {
		return defaultLayout;
	}
	const isSwitchable = displaySettingsConfig.fullscreenLayoutSwitchable;
	if (!isSwitchable) {
		ff2RemoveRaw("fullscreenLayout");
		return defaultLayout;
	}
	const stored = ff2GetRaw("fullscreenLayout");
	return stored === "hero" || stored === "classic" ? stored : defaultLayout;
}

export function applyFullscreenLayoutToDocument(
	layout: FullscreenWallpaperLayout,
	animate = true,
): void {
	if (typeof document === "undefined") return;

	const safeLayout: FullscreenWallpaperLayout =
		layout === "hero" ? "hero" : "classic";
	const html = document.documentElement;
	if (animate) {
		html.classList.add("is-fullscreen-layout-transitioning");
		window.setTimeout(() => {
			html.classList.remove("is-fullscreen-layout-transitioning");
		}, 520);
	}
	html.setAttribute("data-fullscreen-layout", safeLayout);

	const mode = html.getAttribute("data-wallpaper-mode");
	const transparent =
		mode === WALLPAPER_OVERLAY ||
		(mode === WALLPAPER_FULLSCREEN && safeLayout === "hero");
	document.body?.classList.toggle("wallpaper-transparent", transparent);
	window.dispatchEvent(
		new CustomEvent("fullscreenLayoutChange", {
			detail: { layout: safeLayout },
		}),
	);
}

export function setFullscreenLayout(layout: FullscreenWallpaperLayout): void {
	const safeLayout: FullscreenWallpaperLayout =
		layout === "hero" ? "hero" : "classic";
	if (
		typeof localStorage !== "undefined" &&
		typeof localStorage.setItem === "function"
	) {
		localStorage.setItem(ff2Key("fullscreenLayout"), safeLayout);
	}
	applyFullscreenLayoutToDocument(safeLayout);
}

export function applyWallpaperModeToDocument(
	mode: WALLPAPER_MODE,
	animate = true,
): void {
	const html = document.documentElement;
	const isHeroFullscreen =
		html.getAttribute("data-fullscreen-layout") === "hero";

	// 先启用过渡类再设置模式：确保 --content-top 变化时 top 过渡已激活（否则位置瞬间到位不动画）
	if (animate) {
		html.classList.add("is-wallpaper-transitioning");
		window.setTimeout(
			() => html.classList.remove("is-wallpaper-transitioning"),
			520,
		);
	}

	html.setAttribute("data-wallpaper-mode", mode);

	// 首页标题显示：按当前模式 + 是否首页同步 hidden 类（SSR 按 config 默认模式渲染 hidden，
	// 模式运行时切换后需同步）。
	syncBannerHomeTextVisibility();

	// 卡片透明类：唯一运行时写入者（解析期由 body 起始脚本写入）
	const transparent =
		mode === WALLPAPER_OVERLAY ||
		(mode === WALLPAPER_FULLSCREEN && isHeroFullscreen);
	document.body.classList.toggle("wallpaper-transparent", transparent);

	updateNavbarTransparency(mode);
	window.dispatchEvent(
		new CustomEvent("wallpaperModeChange", { detail: { mode } }),
	);
}

export function updateNavbarTransparency(mode: WALLPAPER_MODE): void {
	const navbar = document.getElementById("navbar");
	if (!navbar) return;

	let transparentMode: string;
	let blurAmount: number;

	// 根据当前壁纸模式设置导航栏透明模式和模糊效果
	if (mode === WALLPAPER_OVERLAY) {
		// 全屏透明模式
		transparentMode = "none";
		blurAmount = 0;
	} else if (mode === WALLPAPER_NONE) {
		// 纯色背景模式
		transparentMode = "none";
		blurAmount = 0;
	} else if (mode === WALLPAPER_FULLSCREEN) {
		// 全屏壁纸：首页 + semifull 动态透明，其余半透明玻璃
		const isHomePage = checkIsHomePage(window.location.pathname);
		const fsMode =
			backgroundWallpaper.fullscreen?.navbar?.transparentMode || "semifull";
		const glassBlur = backgroundWallpaper.fullscreen?.navbar?.blur ?? 20;
		transparentMode = fsMode === "semifull" && isHomePage ? "semifull" : "semi";
		blurAmount = glassBlur;
	} else {
		// Banner模式：semifull 仅首页动态，非首页与 fullscreen 一致为半透明
		const isHomePage = checkIsHomePage(window.location.pathname);
		const tMode = backgroundWallpaper.banner?.navbar?.transparentMode || "semi";
		transparentMode = tMode === "semifull" && !isHomePage ? "semi" : tMode;
		blurAmount = backgroundWallpaper.banner?.navbar?.blur ?? 20;
	}

	// 更新导航栏的透明模式属性
	navbar.setAttribute("data-transparent-mode", transparentMode);
	navbar.style.setProperty("--navbar-glass-blur", `${blurAmount}px`);

	// 移除现有的透明模式类
	navbar.classList.remove(
		"navbar-transparent-semi",
		"navbar-transparent-full",
		"navbar-transparent-semifull",
	);

	// 移除scrolled类
	navbar.classList.remove("scrolled");

	// 滚动检测功能
	if (
		transparentMode === "semifull" &&
		(mode === WALLPAPER_BANNER || mode === WALLPAPER_FULLSCREEN) &&
		typeof window.initSemifullScrollDetection === "function"
	) {
		// 在Banner和全屏壁纸模式的semifull下启用滚动检测
		window.initSemifullScrollDetection();
	} else if (window.semifullScrollHandler) {
		// 移除滚动监听器
		window.removeEventListener("scroll", window.semifullScrollHandler);
		delete window.semifullScrollHandler;
	}
}

export function setWallpaperMode(mode: WALLPAPER_MODE): void {
	// 检查是否在浏览器环境中
	if (
		typeof localStorage === "undefined" ||
		typeof localStorage.setItem !== "function"
	) {
		return;
	}
	localStorage.setItem(ff2Key("wallpaperMode"), mode);
	applyWallpaperModeToDocument(mode);
}

export function initWallpaperMode(): void {
	ensureThemeDiagnostics();
	// 初始化透明模式参数（透明度/模糊度/卡片透明度）
	applyStoredOverlaySettingsToDocument();
	const storedMode = getStoredWallpaperMode();
	applyWallpaperModeToDocument(storedMode, false);
}

export function getStoredWallpaperMode(): WALLPAPER_MODE {
	// 检查是否在浏览器环境中
	if (
		typeof localStorage === "undefined" ||
		typeof localStorage.getItem !== "function"
	) {
		return backgroundWallpaper.mode;
	}

	const isSwitchable = displaySettingsConfig.wallpaperModeSwitchable;
	if (!isSwitchable) {
		ff2RemoveRaw("wallpaperMode");
		return backgroundWallpaper.mode;
	}

	return (
		(ff2GetRaw("wallpaperMode") as WALLPAPER_MODE | null) ||
		backgroundWallpaper.mode
	);
}

// 壁纸风格（主组 src / 备用组 altSrc，批四）：存取与切换事件
export type WALLPAPER_SET = "main" | "alt";

export function getStoredWallpaperSet(): WALLPAPER_SET {
	if (
		typeof localStorage === "undefined" ||
		typeof localStorage.getItem !== "function"
	) {
		return "main";
	}
	const isSwitchable = displaySettingsConfig.wallpaperSetSwitchable;
	if (!isSwitchable) {
		ff2RemoveRaw("wallpaperSet");
		return "main";
	}
	return ff2GetRaw("wallpaperSet") === "alt" ? "alt" : "main";
}

export function setWallpaperSet(set: WALLPAPER_SET): void {
	if (
		typeof localStorage === "undefined" ||
		typeof localStorage.setItem !== "function"
	) {
		return;
	}
	if (!displaySettingsConfig.wallpaperSetSwitchable) return;
	localStorage.setItem(ff2Key("wallpaperSet"), set);
	// 壁纸区脚本（WallpaperSection）监听此事件切换 slide 组
	window.dispatchEvent(
		new CustomEvent("wallpaperSetChange", { detail: { set } }),
	);
}

// Overlay settings functions
function clampNumber(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

export function getDefaultOverlayOpacity(): number {
	return backgroundWallpaper.overlay?.opacity ?? 0.8;
}

export function getDefaultOverlayBlur(): number {
	return backgroundWallpaper.overlay?.blur ?? 0;
}

export function getDefaultOverlayCardOpacity(): number {
	return backgroundWallpaper.overlay?.cardOpacity ?? 0.6;
}

export function getStoredOverlayOpacity(): number {
	if (
		typeof localStorage === "undefined" ||
		typeof localStorage.getItem !== "function"
	) {
		return getDefaultOverlayOpacity();
	}
	const stored = ff2GetRaw("overlayOpacity");
	if (stored === null) {
		return getDefaultOverlayOpacity();
	}
	const parsed = Number.parseFloat(stored);
	if (Number.isNaN(parsed)) {
		return getDefaultOverlayOpacity();
	}
	return clampNumber(parsed, 0, 1);
}

export function getStoredOverlayBlur(): number {
	if (
		typeof localStorage === "undefined" ||
		typeof localStorage.getItem !== "function"
	) {
		return getDefaultOverlayBlur();
	}
	const stored = ff2GetRaw("overlayBlur");
	if (stored === null) {
		return getDefaultOverlayBlur();
	}
	const parsed = Number.parseFloat(stored);
	if (Number.isNaN(parsed)) {
		return getDefaultOverlayBlur();
	}
	return clampNumber(parsed, 0, 20);
}

export function getStoredOverlayCardOpacity(): number {
	if (
		typeof localStorage === "undefined" ||
		typeof localStorage.getItem !== "function"
	) {
		return getDefaultOverlayCardOpacity();
	}
	const stored = ff2GetRaw("overlayCardOpacity");
	if (stored === null) {
		return getDefaultOverlayCardOpacity();
	}
	const parsed = Number.parseFloat(stored);
	if (Number.isNaN(parsed)) {
		return getDefaultOverlayCardOpacity();
	}
	return clampNumber(parsed, 0, 1);
}

export function applyOverlayOpacityToDocument(opacity: number): void {
	if (typeof document === "undefined") {
		return;
	}
	const safeOpacity = clampNumber(opacity, 0, 1);
	const wallpaperWrapper = document.getElementById("wallpaper-wrapper");
	if (wallpaperWrapper) {
		wallpaperWrapper.style.setProperty(
			"--overlay-opacity",
			String(safeOpacity),
		);
	}
}

export function applyOverlayBlurToDocument(blur: number): void {
	if (typeof document === "undefined") {
		return;
	}
	const safeBlur = clampNumber(blur, 0, 20);
	const wallpaperWrapper = document.getElementById("wallpaper-wrapper");
	if (wallpaperWrapper) {
		wallpaperWrapper.style.setProperty("--overlay-blur", `${safeBlur}px`);
	}
}

export function applyOverlayCardOpacityToDocument(cardOpacity: number): void {
	if (typeof document === "undefined") {
		return;
	}
	const safeCardOpacity = clampNumber(cardOpacity, 0, 1);
	document.documentElement.style.setProperty(
		"--card-transparent-opacity",
		String(safeCardOpacity),
	);
}

export function setOverlayOpacity(opacity: number): void {
	const safeOpacity = clampNumber(opacity, 0, 1);
	if (
		typeof localStorage !== "undefined" &&
		typeof localStorage.setItem === "function"
	) {
		localStorage.setItem(ff2Key("overlayOpacity"), String(safeOpacity));
	}
	applyOverlayOpacityToDocument(safeOpacity);
}

export function setOverlayBlur(blur: number): void {
	const safeBlur = clampNumber(blur, 0, 20);
	if (
		typeof localStorage !== "undefined" &&
		typeof localStorage.setItem === "function"
	) {
		localStorage.setItem(ff2Key("overlayBlur"), String(safeBlur));
	}
	applyOverlayBlurToDocument(safeBlur);
}

export function setOverlayCardOpacity(cardOpacity: number): void {
	const safeCardOpacity = clampNumber(cardOpacity, 0, 1);
	if (
		typeof localStorage !== "undefined" &&
		typeof localStorage.setItem === "function"
	) {
		localStorage.setItem(ff2Key("overlayCardOpacity"), String(safeCardOpacity));
	}
	applyOverlayCardOpacityToDocument(safeCardOpacity);
}

export function applyStoredOverlaySettingsToDocument(): void {
	applyOverlayOpacityToDocument(getStoredOverlayOpacity());
	applyOverlayBlurToDocument(getStoredOverlayBlur());
	applyOverlayCardOpacityToDocument(getStoredOverlayCardOpacity());
}

// Waves animation functions
export function getDefaultWavesEnabled(): boolean {
	const wavesConfig = backgroundWallpaper.common?.waves?.enable;
	if (typeof wavesConfig === "object") {
		// 如果是分设备配置，检查当前设备
		const isMobile =
			typeof window !== "undefined" ? window.innerWidth < 768 : false;
		return isMobile
			? (wavesConfig.mobile ?? false)
			: (wavesConfig.desktop ?? false);
	}
	return wavesConfig ?? false;
}

export function getStoredWavesEnabled(): boolean {
	if (
		typeof localStorage === "undefined" ||
		typeof localStorage.getItem !== "function"
	) {
		return getDefaultWavesEnabled();
	}
	const stored = ff2GetRaw("wavesEnabled");
	if (stored === null) {
		return getDefaultWavesEnabled();
	}
	return stored === "true";
}

export function setWavesEnabled(enabled: boolean): void {
	if (
		typeof localStorage === "undefined" ||
		typeof localStorage.setItem !== "function"
	) {
		return;
	}
	localStorage.setItem(ff2Key("wavesEnabled"), String(enabled));
	applyWavesEnabledToDocument(enabled);
}

export function applyWavesEnabledToDocument(enabled: boolean): void {
	if (typeof document === "undefined") {
		return;
	}
	// 更新 html 属性，CSS 会立即生效
	document.documentElement.setAttribute("data-waves-enabled", String(enabled));
	// 同时更新元素样式（兼容性）
	const wavesElement = document.getElementById("header-waves");
	if (wavesElement) {
		if (enabled) {
			wavesElement.style.display = "";
			wavesElement.classList.remove("waves-disabled");
		} else {
			wavesElement.style.display = "none";
			wavesElement.classList.add("waves-disabled");
		}
	}
}

// Gradient transition functions
export function getDefaultGradientEnabled(): boolean {
	const gradientConfig = backgroundWallpaper.common?.gradient?.enable;
	if (typeof gradientConfig === "object") {
		const isMobile =
			typeof window !== "undefined" ? window.innerWidth < 768 : false;
		return isMobile
			? (gradientConfig.mobile ?? true)
			: (gradientConfig.desktop ?? true);
	}
	return gradientConfig ?? true;
}

export function getStoredGradientEnabled(): boolean {
	if (
		typeof localStorage === "undefined" ||
		typeof localStorage.getItem !== "function"
	) {
		return getDefaultGradientEnabled();
	}
	const stored = ff2GetRaw("gradientEnabled");
	if (stored === null) {
		return getDefaultGradientEnabled();
	}
	return stored === "true";
}

export function setGradientEnabled(enabled: boolean): void {
	if (
		typeof localStorage === "undefined" ||
		typeof localStorage.setItem !== "function"
	) {
		return;
	}
	localStorage.setItem(ff2Key("gradientEnabled"), String(enabled));
	applyGradientEnabledToDocument(enabled);
}

export function applyGradientEnabledToDocument(enabled: boolean): void {
	if (typeof document === "undefined") {
		return;
	}
	document.documentElement.setAttribute(
		"data-gradient-enabled",
		String(enabled),
	);
	const gradientElement = document.getElementById("wallpaper-gradient");
	if (gradientElement) {
		if (enabled) {
			gradientElement.style.display = "";
			gradientElement.classList.remove("gradient-disabled");
		} else {
			gradientElement.style.display = "none";
			gradientElement.classList.add("gradient-disabled");
		}
	}
}

// Ambient effects functions（自定义氛围特效：落叶/萤火虫/光斑/轻花瓣/风絮）
export function getDefaultAmbientEffects(): Record<AmbientEffectId, boolean> {
	const result = {} as Record<AmbientEffectId, boolean>;
	for (const id of Object.keys(ambientEffectsConfig) as AmbientEffectId[]) {
		result[id] = ambientEffectsConfig[id].enable;
	}
	return result;
}

export function getStoredAmbientEffects(): Record<AmbientEffectId, boolean> {
	const defaults = getDefaultAmbientEffects();
	if (typeof localStorage === "undefined") {
		return defaults;
	}
	try {
		const stored = ff2GetRaw("ambientEffects");
		if (!stored) {
			return defaults;
		}
		const parsed = JSON.parse(stored) as Record<string, unknown>;
		for (const id of Object.keys(defaults) as AmbientEffectId[]) {
			if (typeof parsed[id] === "boolean") {
				defaults[id] = parsed[id];
			}
		}
	} catch {
		// 解析失败回退默认值
	}
	return defaults;
}

export function setAmbientEffectEnabled(
	id: AmbientEffectId,
	enabled: boolean,
): void {
	if (
		typeof localStorage === "undefined" ||
		typeof localStorage.setItem !== "function"
	) {
		return;
	}
	const current = getStoredAmbientEffects();
	current[id] = enabled;
	localStorage.setItem(ff2Key("ambientEffects"), JSON.stringify(current));
	document.documentElement.setAttribute(
		"data-ambient-effects",
		JSON.stringify(current),
	);
	// 实时切换对应特效
	window.dispatchEvent(
		new CustomEvent("ambientEffectsToggle", { detail: { id, enabled } }),
	);
}

export function resetAmbientEffects(): void {
	const defaults = getDefaultAmbientEffects();
	const stored = getStoredAmbientEffects();
	for (const id of Object.keys(defaults) as AmbientEffectId[]) {
		// 只对与默认值不同的项派发事件，避免无谓的重启
		if (stored[id] !== defaults[id]) {
			setAmbientEffectEnabled(id, defaults[id]);
		}
	}
}

// Banner title functions
export function getDefaultBannerTitleEnabled(): boolean {
	return backgroundWallpaper.common?.homeText?.enable ?? true;
}

export function getDefaultBannerCarouselEnabled(): boolean {
	return backgroundWallpaper.common?.carousel?.enable ?? false;
}

export function getStoredBannerTitleEnabled(): boolean {
	if (
		typeof localStorage === "undefined" ||
		typeof localStorage.getItem !== "function"
	) {
		return getDefaultBannerTitleEnabled();
	}
	const stored = ff2GetRaw("bannerTitleEnabled");
	if (stored === null) {
		return getDefaultBannerTitleEnabled();
	}
	return stored === "true";
}

export function getStoredBannerCarouselEnabled(): boolean {
	const isSwitchable = displaySettingsConfig.bannerCarouselSwitchable;
	if (!isSwitchable) {
		return getDefaultBannerCarouselEnabled();
	}
	if (
		typeof localStorage === "undefined" ||
		typeof localStorage.getItem !== "function"
	) {
		return getDefaultBannerCarouselEnabled();
	}
	const stored = ff2GetRaw("bannerCarouselEnabled");
	if (stored === null) {
		return getDefaultBannerCarouselEnabled();
	}
	return stored === "true";
}

export function setBannerTitleEnabled(enabled: boolean): void {
	if (
		typeof localStorage === "undefined" ||
		typeof localStorage.setItem !== "function"
	) {
		return;
	}
	localStorage.setItem(ff2Key("bannerTitleEnabled"), String(enabled));
	applyBannerTitleEnabledToDocument(enabled);
}

export function setBannerCarouselEnabled(enabled: boolean): void {
	const safeEnabled = !!enabled;
	const isSwitchable = displaySettingsConfig.bannerCarouselSwitchable;
	if (
		isSwitchable &&
		typeof localStorage !== "undefined" &&
		typeof localStorage.setItem === "function"
	) {
		localStorage.setItem(ff2Key("bannerCarouselEnabled"), String(safeEnabled));
	}
	applyBannerCarouselEnabledToDocument(safeEnabled);
	if (typeof window !== "undefined") {
		window.dispatchEvent(
			new CustomEvent("bannerCarouselChange", {
				detail: { enabled: safeEnabled },
			}),
		);
	}
}

export function applyBannerTitleEnabledToDocument(enabled: boolean): void {
	if (typeof document === "undefined") {
		return;
	}
	// 更新 html 属性，CSS 会立即生效
	document.documentElement.setAttribute(
		"data-banner-title-enabled",
		String(enabled),
	);
	// 同时更新元素样式（兼容性）
	const bannerTextOverlay = document.querySelector(
		".banner-home-text-overlay",
	) as HTMLElement;
	if (bannerTextOverlay) {
		if (enabled) {
			bannerTextOverlay.classList.remove("user-hidden");
		} else {
			bannerTextOverlay.classList.add("user-hidden");
		}
	}
}

export function applyBannerCarouselEnabledToDocument(enabled: boolean): void {
	if (typeof document === "undefined") {
		return;
	}
	document.documentElement.setAttribute(
		"data-banner-carousel-enabled",
		String(enabled),
	);
}

// Card border functions
export function getDefaultCardBorderEnabled(): boolean {
	return siteConfig.card?.border ?? false;
}

export function getStoredCardBorderEnabled(): boolean {
	if (typeof localStorage === "undefined") {
		return getDefaultCardBorderEnabled();
	}
	const stored = ff2GetRaw("cardBorderEnabled");
	if (stored === null) {
		return getDefaultCardBorderEnabled();
	}
	return stored === "true";
}

export function setCardBorderEnabled(enabled: boolean): void {
	if (
		typeof localStorage === "undefined" ||
		typeof localStorage.setItem !== "function"
	) {
		return;
	}
	localStorage.setItem(ff2Key("cardBorderEnabled"), String(enabled));
	if (enabled) {
		document.documentElement.classList.add("enable-card-border");
	} else {
		document.documentElement.classList.remove("enable-card-border");
	}
}

// Card follow theme functions
export function getDefaultCardFollowThemeEnabled(): boolean {
	return siteConfig.card?.followTheme ?? false;
}

export function getStoredCardFollowThemeEnabled(): boolean {
	if (typeof localStorage === "undefined") {
		return getDefaultCardFollowThemeEnabled();
	}
	const stored = ff2GetRaw("cardFollowThemeEnabled");
	if (stored === null) {
		return getDefaultCardFollowThemeEnabled();
	}
	return stored === "true";
}

export function setCardFollowThemeEnabled(enabled: boolean): void {
	if (
		typeof localStorage === "undefined" ||
		typeof localStorage.setItem !== "function"
	) {
		return;
	}
	localStorage.setItem(ff2Key("cardFollowThemeEnabled"), String(enabled));
	if (enabled) {
		document.body.classList.add("card-follow-theme-hue");
	} else {
		document.body.classList.remove("card-follow-theme-hue");
	}
}
