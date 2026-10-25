// 面板「特效」页的实体图标：每个特效画它自己的实体（落叶就是叶子、萤火虫就是光点），
// 不再用 mdi 字形（leaf-maple/firefly/blur/weather-windy 不在打包图标集里，渲染成占位圆圈）。
// 全部为 24×24 viewBox 的内联 SVG，颜色取自对应特效画布里的实体色。
import type { AmbientEffectId } from "@/types/effectsConfig";

const svg = (body: string) =>
	`<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${body}</svg>`;

export const effectIconSvg: Record<AmbientEffectId, string> = {
	// 落叶：叶身 + 主脉
	leaves: svg(
		`<path d="M12 3C16.2 6.8 18.4 11.6 12 21C5.6 11.6 7.8 6.8 12 3Z" fill="#8aa06e"/>
		 <path d="M12 6.5V17.5" stroke="#5d7350" stroke-width="1" stroke-linecap="round"/>`,
	),
	// 萤火虫：黄绿光晕 + 亮芯
	fireflies: svg(
		`<defs><radialGradient id="eff-firefly-g"><stop offset="0" stop-color="#eef6b0" stop-opacity="0.95"/><stop offset="0.45" stop-color="#dced82" stop-opacity="0.4"/><stop offset="1" stop-color="#dced82" stop-opacity="0"/></radialGradient></defs>
		 <circle cx="12" cy="12" r="10" fill="url(#eff-firefly-g)"/>
		 <circle cx="12" cy="12" r="1.6" fill="#f7fbd8"/>`,
	),
	// 光斑：大而柔的半透明圆盘
	bokeh: svg(
		`<defs><radialGradient id="eff-bokeh-g"><stop offset="0" stop-color="#f2efe4" stop-opacity="0.75"/><stop offset="0.6" stop-color="#f2efe4" stop-opacity="0.4"/><stop offset="0.88" stop-color="#f2efe4" stop-opacity="0.12"/><stop offset="1" stop-color="#f2efe4" stop-opacity="0"/></radialGradient></defs>
		 <circle cx="12" cy="12" r="10" fill="url(#eff-bokeh-g)"/>`,
	),
	// 花瓣：樱粉色单瓣
	petals: svg(
		`<path d="M12 3.5C16.5 6.5 18.5 11 12 20.5C5.5 11 7.5 6.5 12 3.5Z" fill="#e8a8bf"/>
		 <path d="M12 6V17" stroke="#d68aa6" stroke-width="0.9" stroke-linecap="round"/>`,
	),
	// 风：三道波浪流线（流场风痕）
	wind: svg(
		`<path d="M3 8.5C6.5 6.5 9 10.5 12.5 8.5C15 7 17.5 7.5 21 9" stroke="#9db0a4" stroke-width="1.7" stroke-linecap="round"/>
		 <path d="M3 14C6.5 12 9 16 12.5 14C15 12.5 17.5 13 21 14.5" stroke="#9db0a4" stroke-width="1.4" stroke-linecap="round" opacity="0.7"/>
		 <path d="M6.5 19C9 17.6 11.5 20 14.5 18.6" stroke="#9db0a4" stroke-width="1.1" stroke-linecap="round" opacity="0.45"/>`,
	),
	// 蝴蝶：双翅 + 身体
	butterflies: svg(
		`<path d="M12 12C8.5 7.5 3.5 8 3 11C2.6 13.8 6.5 15.5 11 14.2" fill="#d99a55"/>
		 <path d="M12 12C15.5 7.5 20.5 8 21 11C21.4 13.8 17.5 15.5 13 14.2" fill="#d99a55"/>
		 <path d="M12 12C9.5 14 8.5 17 9.5 18.5C10.6 20 12.2 17.5 12 14.5" fill="#c07f3e" opacity="0.85"/>
		 <path d="M12 12C14.5 14 15.5 17 14.5 18.5C13.4 20 11.8 17.5 12 14.5" fill="#c07f3e" opacity="0.85"/>
		 <ellipse cx="12" cy="12.5" rx="0.9" ry="3.4" fill="#6b4a26"/>`,
	),
	// 细雨：三道斜雨丝 + 雨滴
	drizzle: svg(
		`<path d="M8 3.5L5.5 10" stroke="#7f97ab" stroke-width="1.6" stroke-linecap="round"/>
		 <path d="M14.5 3.5L12 10" stroke="#7f97ab" stroke-width="1.6" stroke-linecap="round"/>
		 <path d="M19 7L17 12" stroke="#7f97ab" stroke-width="1.4" stroke-linecap="round" opacity="0.7"/>
		 <path d="M10.5 14.5C11.8 14.5 12.6 15.6 12 16.8C11.4 18 10.2 18.6 9.6 17.9C9 17.2 9.4 15.4 10.5 14.5Z" fill="#7f97ab"/>
		 <path d="M16 18.5C17 18.5 17.6 19.4 17.1 20.3C16.6 21.2 15.7 21.6 15.2 21C14.7 20.4 15.1 19.1 16 18.5Z" fill="#7f97ab" opacity="0.7"/>`,
	),
	// 雪花：六臂冰晶
	snow: svg(
		`<g stroke="#a9c3d6" stroke-width="1.3" stroke-linecap="round">
		 <path d="M12 3V21M4.2 7.5L19.8 16.5M19.8 7.5L4.2 16.5"/>
		 <path d="M12 6.5L9.8 5M12 6.5L14.2 5M12 17.5L9.8 19M12 17.5L14.2 19"/>
		 </g>`,
	),
	// 繁星：大四角星芒 + 小星 + 星点
	stars: svg(
		`<path d="M12 3C12.7 8.2 13.8 9.3 19 10C13.8 10.7 12.7 11.8 12 17C11.3 11.8 10.2 10.7 5 10C10.2 9.3 11.3 8.2 12 3Z" fill="#f2e9bd"/>
		 <path d="M18.5 14.7C18.75 16.6 19.35 17.2 21.2 17.5C19.35 17.8 18.75 18.4 18.5 20.3C18.25 18.4 17.65 17.8 15.8 17.5C17.65 17.2 18.25 16.6 18.5 14.7Z" fill="#f2e9bd" opacity="0.8"/>
		 <circle cx="6" cy="18" r="0.8" fill="#f2e9bd" opacity="0.55"/>
		 <circle cx="9.5" cy="20.5" r="0.6" fill="#f2e9bd" opacity="0.4"/>`,
	),
	// 丁达尔：三道斜射光柱（顶亮渐隐）+ 光尘
	tyndall: svg(
		`<defs><linearGradient id="eff-tyndall-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff8d8" stop-opacity="0.9"/><stop offset="1" stop-color="#fff8d8" stop-opacity="0.05"/></linearGradient></defs>
		 <path d="M6.5 3L3 21" stroke="url(#eff-tyndall-g)" stroke-width="2.6" stroke-linecap="round"/>
		 <path d="M13 3L9.5 21" stroke="url(#eff-tyndall-g)" stroke-width="1.9" stroke-linecap="round" opacity="0.75"/>
		 <path d="M19.5 3L16 21" stroke="url(#eff-tyndall-g)" stroke-width="1.2" stroke-linecap="round" opacity="0.5"/>
		 <circle cx="18" cy="7.5" r="0.8" fill="#fff8d8" opacity="0.85"/>
		 <circle cx="11.5" cy="13.5" r="0.6" fill="#fff8d8" opacity="0.6"/>`,
	),
	// 蒲公英：伞冠细丝 + 丝端珠点 + 细柄 + 瘦果
	dandelion: svg(
		`<g stroke="#c7c0ab" stroke-width="0.8" stroke-linecap="round">
		 <path d="M12 9L5.5 3.8M12 9L8.2 2.9M12 9V2.3M12 9L15.8 2.9M12 9L18.5 3.8M12 9L6.6 6M12 9L17.4 6"/>
		 </g>
		 <g fill="#c7c0ab">
		 <circle cx="5.5" cy="3.8" r="0.7"/><circle cx="8.2" cy="2.9" r="0.7"/><circle cx="12" cy="2.3" r="0.7"/><circle cx="15.8" cy="2.9" r="0.7"/><circle cx="18.5" cy="3.8" r="0.7"/><circle cx="6.6" cy="6" r="0.7"/><circle cx="17.4" cy="6" r="0.7"/>
		 </g>
		 <path d="M12 9V13.5" stroke="#a89f88" stroke-width="1.1" stroke-linecap="round"/>
		 <path d="M12 13.5C13.2 14.8 13.2 17.5 12 20C10.8 17.5 10.8 14.8 12 13.5Z" fill="#a89f88"/>`,
	),
};
