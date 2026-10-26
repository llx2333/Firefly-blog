import { backgroundWallpaper } from "../config";
import type {
	ThemeWallpaperPair,
	WallpaperSeason,
} from "../types/backgroundWallpaper";

export type BackgroundImages = {
	desktop: string[];
	mobile: string[];
	isMultiple: boolean;
};

// 季节池（批六）：按季节分组的壁纸，只在对应季节并入主组轮播
export type SeasonalBackgroundImages = {
	desktop: Partial<Record<WallpaperSeason, string[]>>;
	mobile: Partial<Record<WallpaperSeason, string[]>>;
};

// 主题配对池（批七）：亮/暗近似双版的场景对，按访客当前主题只显示对应版本
export type ThemePairedBackgroundImages = {
	desktop: ThemeWallpaperPair[];
	mobile: ThemeWallpaperPair[];
};

// 将单个值或数组统一为数组
const toArray = (src: string | string[] | undefined): string[] => {
	if (!src) return [];
	if (Array.isArray(src)) return src;
	return [src];
};

// 背景图片处理工具函数
// 返回所有配置的图片（用于构建时渲染所有图片）
export const getBackgroundImages = (): BackgroundImages => {
	const bgSrc = backgroundWallpaper.src;

	if (
		typeof bgSrc === "object" &&
		bgSrc !== null &&
		!Array.isArray(bgSrc) &&
		("desktop" in bgSrc || "mobile" in bgSrc)
	) {
		const srcObj = bgSrc as {
			desktop?: string | string[];
			mobile?: string | string[];
		};
		const desktopImages = toArray(srcObj.desktop);
		const mobileImages = toArray(srcObj.mobile);
		return {
			desktop: desktopImages.length > 0 ? desktopImages : mobileImages,
			mobile: mobileImages.length > 0 ? mobileImages : desktopImages,
			isMultiple: desktopImages.length > 1 || mobileImages.length > 1,
		};
	}
	// 如果是字符串或数组，同时用于桌面端和移动端
	const images = toArray(bgSrc as string | string[]);
	return {
		desktop: images,
		mobile: images,
		isMultiple: images.length > 1,
	};
};

// 备用壁纸组（批四：主题原配流萤壁纸）。结构与 getBackgroundImages 一致，
// 但不配置 altSrc 时返回空数组——调用方据此决定是否渲染备用组与切换入口
export const getAltBackgroundImages = (): BackgroundImages => {
	const altSrc = backgroundWallpaper.altSrc;
	if (!altSrc) {
		return { desktop: [], mobile: [], isMultiple: false };
	}
	const desktopImages = toArray(altSrc.desktop);
	const mobileImages = toArray(altSrc.mobile);
	return {
		desktop: desktopImages.length > 0 ? desktopImages : mobileImages,
		mobile: mobileImages.length > 0 ? mobileImages : desktopImages,
		isMultiple: desktopImages.length > 1 || mobileImages.length > 1,
	};
};

// 季节池（批六）：读 src.desktopSeasonal / mobileSeasonal。
// 季节的判定不在这里做——SSR 算季节会冻结在构建日，由 WallpaperSection
// 的内联脚本按访客月份过滤；这里只负责把四个季节的池子原样递过去
export const getSeasonalBackgroundImages = (): SeasonalBackgroundImages => {
	const bgSrc = backgroundWallpaper.src;
	if (typeof bgSrc === "object" && bgSrc !== null && !Array.isArray(bgSrc)) {
		const srcObj = bgSrc as {
			desktopSeasonal?: Partial<Record<WallpaperSeason, string[]>>;
			mobileSeasonal?: Partial<Record<WallpaperSeason, string[]>>;
		};
		return {
			desktop: srcObj.desktopSeasonal ?? {},
			mobile: srcObj.mobileSeasonal ?? {},
		};
	}
	return { desktop: {}, mobile: {} };
};

// 主题配对池（批七）：读 src.desktopThemePairs / mobileThemePairs。
// 亮暗判定在客户端做（跟随访客的实时主题，含跟随系统模式的变化），
// 这里只负责把配对列表原样递过去；未配置返回空数组
export const getThemePairedBackgroundImages =
	(): ThemePairedBackgroundImages => {
		const bgSrc = backgroundWallpaper.src;
		if (typeof bgSrc === "object" && bgSrc !== null && !Array.isArray(bgSrc)) {
			const srcObj = bgSrc as {
				desktopThemePairs?: ThemeWallpaperPair[];
				mobileThemePairs?: ThemeWallpaperPair[];
			};
			return {
				desktop: srcObj.desktopThemePairs ?? [],
				mobile: srcObj.mobileThemePairs ?? [],
			};
		}
		return { desktop: [], mobile: [] };
	};

// 类型守卫函数
export const isBannerSrcObject = (
	src:
		| string
		| string[]
		| { desktop?: string | string[]; mobile?: string | string[] },
): src is { desktop?: string | string[]; mobile?: string | string[] } => {
	return (
		typeof src === "object" &&
		src !== null &&
		!Array.isArray(src) &&
		("desktop" in src || "mobile" in src)
	);
};

// 获取默认背景图片（返回第一张，用于 SEO 等场景）
export const getDefaultBackground = (): string => {
	const images = getBackgroundImages();
	return images.desktop[0] || images.mobile[0] || "";
};

// 检查是否为首页
export const isHomePage = (pathname: string): boolean => {
	// 获取 base URL
	const baseUrl = import.meta.env.BASE_URL || "/";
	const baseUrlNoSlash = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;

	if (pathname === baseUrl) return true;
	if (pathname === baseUrlNoSlash) return true;
	if (pathname === "/") return true;

	return false;
};

// 获取横幅偏移量
export const getBannerOffset = (position = "center"): string => {
	const bannerOffsetByPosition = {
		top: "100vh",
		center: "50vh",
		bottom: "0",
	};
	return (
		bannerOffsetByPosition[position as keyof typeof bannerOffsetByPosition] ||
		"50vh"
	);
};
