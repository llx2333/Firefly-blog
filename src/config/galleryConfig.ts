import type { GalleryConfig } from "@/types/galleryConfig";

// 相册配置
export const galleryConfig: GalleryConfig = {
	// 相册列表
	// 批二清空演示相册（可爱流萤/加密示例）；建自己的相册：
	// 1. 在 public/gallery/ 下建子目录（目录名 = id），把照片放进去（可用 urls.txt 列出图片地址）
	// 2. 照下面注释的格式加一条配置；封面图可放 cover.avif 或用 cover 字段指定
	// password/passwordHint 可选，设置后需输入密码才能看
	albums: [
		// {
		// 	id: "my-album",
		// 	name: "相册名字",
		// 	description: "一句话描述",
		// 	location: "拍摄地点",
		// 	date: "2026-01-01",
		// 	tags: ["标签"],
		// 	// password: "123456",
		// 	// passwordHint: "密码提示",
		// },
	],

	// 瀑布流最小列宽(px)，浏览器根据容器宽度自动计算列数，默认 240
	// 值越小列数越多，值越大列数越少
	columnWidth: 240,
};
