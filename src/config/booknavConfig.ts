import type { BooknavGroup, BooknavPageConfig } from "../types/booknavConfig";

// 书签导航页面配置
export const booknavPageConfig: BooknavPageConfig = {
	// 页面标题，如果留空则使用 i18n 中的翻译
	title: "",

	// 页面描述文本，如果留空则使用 i18n 中的翻译
	description: "",

	// favicon 自动获取配置
	favicon: {
		// 书签未填写 icon 时，是否自动获取目标站点的 favicon 图标
		enabled: true,

		// favicon 接口地址，{domain} 为占位符，会被替换成目标站点域名
		// 更换接口只需保证地址里含有 {domain}，例如：
		//   https://a.favicon.im/{domain}
		//   https://favicon.im/{domain}
		api: "https://a.favicon.im/{domain}",
	},
};

// 书签导航配置
// 每个数组项是一个分类组，分类组内的 items 是该分类下的书签
// 批二清空演示书签；加自己的书签照下面注释的格式写：
// 一个组 = 侧边一个分类（id 唯一、name 显示名、icon 图标、weight 排序）；
// 组内每条 = 一个书签（title/url/desc，icon 可选，不填自动抓 favicon）
export const booknavConfig: BooknavGroup[] = [
	// {
	// 	id: "dev",
	// 	name: "开发",
	// 	icon: "material-symbols:code-rounded",
	// 	desc: "写代码时离不开的站点",
	// 	weight: 100,
	// 	items: [
	// 		{
	// 			title: "GitHub",
	// 			url: "https://github.com",
	// 			desc: "全球最大的代码托管平台",
	// 			// icon 字段可以使用 astro-icon 图标库的图标名称
	// 			// 也可以使用图片 URL 和本地图片路径
	// 			// 不填则会通过接口自动获取目标站点的 favicon 图标（需要在上面配置）
	// 			icon: "fa7-brands:github",
	// 			weight: 10,
	// 		},
	// 	],
	// },
];
