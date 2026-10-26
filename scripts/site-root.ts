import { existsSync } from "node:fs";

/**
 * 构建产物根目录。
 *
 * Cloudflare Pages 上构建时启用了 @astrojs/cloudflare adapter（CF_WORKERS 环境变量），
 * Astro 把静态站点输出到 dist/client；本地直接跑 astro build 时输出到 dist。
 */
export function resolveSiteRoot(): string {
	// 本地验证构建可显式指向临时产物目录，避免子集脚本改写/删除
	// 正在被预览服务器使用的 dist/ 下文件（scripts/subset-fonts.ts 复用本解析）。
	const override = process.env.SITE_OUT_DIR;
	if (override) return override;
	return existsSync("dist/client") ? "dist/client" : "dist";
}
