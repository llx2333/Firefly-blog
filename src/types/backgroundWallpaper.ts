export type FullscreenWallpaperLayout = "classic" | "hero";

// 壁纸季节（批六）：北半球气象季节，客户端按访问月份判定
export type WallpaperSeason = "spring" | "summer" | "autumn" | "winter";

// 主题配对壁纸（批七）：同一场景的亮/暗两个近似版本，一个配对占一个轮播位，
// 客户端按当前亮暗色主题只实例化对应版本，切主题时直接换图；
// 只有单版本的图不用配对，两种主题下都显示
export type ThemeWallpaperPair = {
	light: string; // 亮色主题下显示的版本（明亮/晨雾光线）
	dark: string; // 暗色主题下显示的版本（暗一点/金昏暖光）
	// 季节配对（批七）：带 season 的配对只在对应季节进入轮播（如春季花树、秋季柿子）；
	// 成员不要再出现在 desktop/mobile/seasonal 数组里，否则同一张图会渲染两份
	season?: WallpaperSeason;
};

export type BackgroundWallpaperConfig = {
	mode: "banner" | "fullscreen" | "overlay" | "none"; // 壁纸模式：banner横幅模式、fullscreen全屏壁纸、overlay全屏透明覆盖模式或none纯色背景
	playerEnable?: boolean; // 是否启用背景视频播放，默认false
	src:
		| string
		| string[]
		| {
				desktop?: string | string[];
				mobile?: string | string[];
				// 季节池（批六）：季节特征极强的图只在其对应季节并入轮播；
				// 未配置或空数组时主组就是纯通用池，行为与之前一致
				desktopSeasonal?: Partial<Record<WallpaperSeason, string[]>>;
				mobileSeasonal?: Partial<Record<WallpaperSeason, string[]>>;
				// 主题配对池（批七）：亮/暗近似双版的场景对，一个配对占一个轮播位，
				// 按当前主题只下载显示对应版本；配对成员不要再出现在
				// desktop/mobile/seasonal 数组里，否则同一张图会渲染两份
				desktopThemePairs?: ThemeWallpaperPair[];
				mobileThemePairs?: ThemeWallpaperPair[];
				playerUrl?: string | string[]; // 背景视频播放地址，支持单个视频路径或数组（多视频列表循环）
		  }; // 支持单个图片、图片数组或分别设置桌面端和移动端图片
	// 备用壁纸组（批四）：配置后设置面板出现「壁纸风格」切换，默认用 src（主组），
	// 访客可手动切到这组并在本地记住；不配置则不渲染备用组也不显示切换入口
	altSrc?: {
		desktop?: string | string[];
		mobile?: string | string[];
	};
	// 横幅壁纸和全屏壁纸共享配置
	common?: {
		dimOpacity?: number; // 横幅文字遮罩暗度，0-1之间，值越大越暗，默认0.15
		playerMode?: "order" | "random"; // 多视频播放模式："order" 顺序循环（默认），"random" 随机切换
		homeText?: {
			enable: boolean; // 是否在首页显示自定义文字（全局开关）
			title?: string; // 主标题
			subtitle?: string | string[]; // 副标题，支持单个字符串或字符串数组
			titleSize?: string; // 主标题字体大小，如 "3.5rem"
			subtitleSize?: string; // 副标题字体大小，如 "1.5rem"
			typewriter?: {
				enable: boolean; // 是否启用打字机效果
				speed: number; // 打字速度（毫秒）
				deleteSpeed: number; // 删除速度（毫秒）
				pauseTime: number; // 完整显示后的暂停时间（毫秒）
			};
			// 首页横幅标题下方的链接图标（可选）
			linksEnable?: boolean; // 是否显示标题下方的链接图标（默认 true）
			links?: {
				name: string; // 名称（用于 aria-label / title / 可选 showName 显示）
				url: string; // 链接地址
				icon: string; // Iconify 图标，如 "fa7-brands:github"
				showName?: boolean; // 是否显示文字（默认 false）
			}[];
		};
		// 壁纸轮播配置，横幅壁纸和全屏壁纸共享
		carousel?: {
			enable: boolean; // 是否启用壁纸轮播
			interval?: number; // 轮播间隔时间，单位毫秒
			transitionEffect?: "fade" | "zoom" | "slide" | "kenburns"; // 过渡效果: 'fade' 渐变 | 'zoom' 缩放 | 'slide' 滑动 | 'kenburns' 旋转木马
		};
		// 水波纹动画效果配置，横幅壁纸和全屏壁纸共享，开启会影响页面性能
		waves?: {
			enable:
				| boolean
				| {
						desktop: boolean; // 桌面端是否启用水波纹动画效果
						mobile: boolean; // 移动端是否启用水波纹动画效果
				  }; // 是否启用水波纹动画效果，支持布尔值或分别设置桌面端和移动端
		};
		// 渐变过渡效果配置，当水波纹关闭时自动启用，提供壁纸底部到背景色的平滑过渡
		gradient?: {
			enable:
				| boolean
				| {
						desktop: boolean; // 桌面端是否启用渐变过渡
						mobile: boolean; // 移动端是否启用渐变过渡
				  }; // 是否启用渐变过渡，支持布尔值或分别设置桌面端和移动端，默认true（水波纹关闭时自动生效）
			height?: string; // 渐变高度，默认 "30vh"
		};
	};

	// Banner模式特有配置
	banner?: {
		position?:
			| "top"
			| "center"
			| "bottom"
			| "top left"
			| "top center"
			| "top right"
			| "center left"
			| "center center"
			| "center right"
			| "bottom left"
			| "bottom center"
			| "bottom right"
			| "left top"
			| "left center"
			| "left bottom"
			| "right top"
			| "right center"
			| "right bottom"
			| string; // 壁纸位置，支持CSS object-position的所有值，包括百分比和像素值
		// 文章横幅信息："description" 显示描述，"meta" 显示日期、字数和阅读时长
		postInfo?: {
			mode: "description" | "meta";
		};
		navbar?: {
			transparentMode?: "semi" | "semifull" | "none"; // 导航栏透明模式："semi" 半透明，"semifull" 动态透明，"none" 纯色不透明
			blur?: number; // 毛玻璃模糊度，0 即关闭导航栏毛玻璃
		};
	};
	// 全屏透明覆盖模式特有配置
	overlay?: {
		zIndex?: number; // 层级，确保壁纸在合适的层级显示
		opacity?: number; // 壁纸透明度，0-1之间
		blur?: number; // 背景模糊程度，单位px
		cardOpacity?: number; // 卡片背景透明度，0-1之间
	};
	// 全屏壁纸模式特有配置
	fullscreen?: {
		layout?: FullscreenWallpaperLayout; // 全屏布局：classic 文档流模式，hero 固定全屏首屏模式
		position?: string; // 壁纸位置，支持CSS object-position的所有值
		// 全屏壁纸模式的导航栏配置（仅有半透明/动态透明两种）
		navbar?: {
			transparentMode?: "semi" | "semifull"; // 导航栏透明模式："semi" 半透明，"semifull" 动态透明（仅首页顶部透明）
			blur?: number; // 导航栏毛玻璃模糊度，0 即关闭（玻璃态生效）
		};
		// 首页下滑时壁纸模糊渐变开关（从 0 渐变为 overlay.blur 的最大模糊）
		blurRamp?: {
			enable:
				| boolean
				| {
						desktop: boolean; // 桌面端是否启用模糊渐变
						mobile: boolean; // 移动端是否启用模糊渐变
				  }; // 是否启用模糊渐变，支持布尔值或分别设置桌面端和移动端，默认 true
		};
	};
};
