import type { SponsorConfig } from "../types/sponsorConfig";

export const sponsorConfig: SponsorConfig = {
	// 页面标题，如果留空则使用 i18n 中的翻译
	title: "",

	// 页面描述文本，如果留空则使用 i18n 中的翻译
	description: "",

	// 打赏用途说明
	usage:
		"打赏全凭心意——就像路过菜地顺手浇瓢水，不浇也长得好好的，浇了就多结两个瓜。",

	// 是否显示打赏者列表
	showSponsorsList: true,

	// 是否显示评论区，需要先在commentConfig.ts启用评论系统
	showComment: true,

	// 是否在文章详情页底部显示打赏按钮
	// 批二下架打赏（收款码齐了想重新上架：改回 true，并在下面 methods 里放开/填上自己的收款方式）
	showButtonInPost: false,

	// 打赏方式列表
	// 批二全部下架：原配置里收款链接指向主题作者、收款码是演示图，已整体注释保留作格式范例
	// 两种写法：qrCode 填收款码图片路径（放 public 目录，如 /assets/images/sponsor/alipay.png）；
	// 或者 link 填跳转链接（如爱发电/ko-fi 主页），qrCode 留空
	methods: [
		// {
		// 	name: "支付宝",
		// 	icon: "fa7-brands:alipay",
		// 	qrCode: "/assets/images/sponsor/alipay.png",
		// 	link: "",
		// 	description: "使用 支付宝 扫码打赏",
		// 	enabled: true,
		// },
		// {
		// 	name: "微信",
		// 	icon: "fa7-brands:weixin",
		// 	qrCode: "/assets/images/sponsor/wechat.png",
		// 	link: "",
		// 	description: "使用 微信 扫码打赏",
		// 	enabled: true,
		// },
		// {
		// 	name: "爱发电",
		// 	icon: "simple-icons:afdian",
		// 	qrCode: "",
		// 	link: "https://ifdian.net/a/你的账号",
		// 	description: "通过 爱发电 进行打赏",
		// 	enabled: true,
		// },
	],

	// 打赏者列表（可选）
	// 批二清空演示记录；有真实打赏后照格式添加
	sponsors: [
		// {
		// 	name: "打赏者名字",
		// 	avatar: "https://example.com/avatar.png", // 可省略
		// 	amount: "¥50",
		// 	date: "2026-01-01",
		// },
	],
};
