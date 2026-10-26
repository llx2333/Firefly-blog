import I18nKey from "../i18n/i18nKey";
import type {
	AmbientEffectConfig,
	AmbientEffectId,
	AmbientEffectTheme,
} from "../types/effectsConfig";

// 特效配置 - 集中管理所有动画特效
// （原樱花特效已移除：与「轻盈花瓣」重复，批九第四轮按用户拍板下线；
//   花瓣仍复用 /assets/images/effects/sakura.png 素材）

// 自定义氛围特效配置：轻量粒子（主线程 Canvas 2D，单画布多画笔），
// 生命周期为固定覆盖层画布 / resize 节流 / visibilitychange 暂停 /
// 明暗主题感知。全部默认关闭，访客在设置面板「特效」页逐项开关
// （localStorage "ambientEffects" 持久化）。
export const ambientEffectsConfig: Record<
	AmbientEffectId,
	AmbientEffectConfig
> = {
	// 落叶飘落：低饱和秋叶缓摆下落
	leaves: { enable: false, count: 14, zIndex: 100 },
	// 萤火虫光点：暖黄绿光点游移闪烁，暗色主题可见、亮色主题自动隐去
	fireflies: { enable: false, count: 22, zIndex: 100 },
	// 光斑尘埃：大而柔的散景光斑缓慢上浮
	bokeh: { enable: false, count: 13, zIndex: 100 },
	// 轻盈花瓣：原生樱花素材的低密度版（数量减半、更小更慢），仍用樱花图渲染
	petals: { enable: false, count: 9, zIndex: 100 },
	// 风痕流动：时变流场驱动的成阵风痕（一阵 = 同一带内一批细流线扫过）
	wind: { enable: false, count: 26, zIndex: 100 },
	// 蝴蝶飞舞：双翅扑动的田园蝴蝶
	butterflies: { enable: false, count: 6, zIndex: 100 },
	// 细雨绵绵：斜落的细雨丝
	drizzle: { enable: false, count: 90, zIndex: 100 },
	// 雪花纷飞：轻缓飘落的小雪
	snow: { enable: false, count: 50, zIndex: 100 },
	// 夜空繁星：闪烁星场 + 亮星十字星芒 + 偶发流星点缀，仅暗色主题可见
	stars: { enable: false, count: 90, zIndex: 100 },
	// 蒲公英絮：伞冠细丝 + 细柄 + 瘦果的真实种子形态，随风摇摆漂移
	dandelion: { enable: false, count: 10, zIndex: 100 },
	// 丁达尔光柱：同一太阳收敛的软边光束 + 浮尘，仅亮色主题可见
	tyndall: { enable: false, count: 5, zIndex: 100 },
};

// 面板「特效」页的展示顺序与文案 key（图标为各特效实体 SVG，见 controls/effect-icons.ts）
// themes 缺省 = 暗/亮通用；单主题特效在另一主题下面板禁用并提示
export const ambientEffectMeta: {
	id: AmbientEffectId;
	key: I18nKey;
	themes?: AmbientEffectTheme[];
}[] = [
	{ id: "leaves", key: I18nKey.fallingLeavesEffect },
	{ id: "fireflies", key: I18nKey.firefliesEffect, themes: ["dark"] },
	{ id: "bokeh", key: I18nKey.bokehDustEffect },
	{ id: "petals", key: I18nKey.lightPetalsEffect },
	{ id: "wind", key: I18nKey.windDriftEffect },
	{ id: "butterflies", key: I18nKey.butterfliesEffect },
	{ id: "drizzle", key: I18nKey.drizzleEffect },
	{ id: "snow", key: I18nKey.snowfallEffect },
	{ id: "stars", key: I18nKey.starrySkyEffect, themes: ["dark"] },
	{ id: "dandelion", key: I18nKey.dandelionEffect },
	{ id: "tyndall", key: I18nKey.tyndallEffect, themes: ["light"] },
];
