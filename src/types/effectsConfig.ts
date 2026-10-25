// 自定义氛围特效 id（设置面板「特效」页逐项开关）
export type AmbientEffectId =
	| "leaves" // 落叶飘落
	| "fireflies" // 萤火虫光点（仅暗色）
	| "bokeh" // 光斑尘埃
	| "petals" // 轻盈花瓣（复用樱花花瓣图素材）
	| "wind" // 风痕流动（流场风痕成阵）
	| "butterflies" // 蝴蝶飞舞
	| "drizzle" // 细雨绵绵
	| "snow" // 雪花纷飞
	| "stars" // 夜空繁星（仅暗色）
	| "dandelion" // 蒲公英絮
	| "tyndall"; // 丁达尔光柱（仅亮色）

export type AmbientEffectConfig = {
	// 是否默认启用（访客可在面板「特效」页覆盖，localStorage 持久化）
	enable: boolean;
	// 粒子数量
	count: number;
	// 层级（全屏覆盖层画布）
	zIndex: number;
};

// 特效适配的主题（面板按当前解析主题禁用不兼容行，引擎按 themeMix 兜底跳过）
export type AmbientEffectTheme = "dark" | "light";
