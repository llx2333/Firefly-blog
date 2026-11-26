/**
 * 清空 Astro 内容层缓存（项目根 .astro/ 与 node_modules/.astro/）
 * 内容层缓存不随 markdown 管线/插件配置变化失效，文章源文件未改动时会复用旧渲染产物
 * （曾导致 CF Workers Builds 部署的文章页引用已淘汰的旧 CSS chunk：构建缓存恢复
 * node_modules/.astro 后，未改动的文章直接复用旧构建的渲染 HTML）。
 * 每次构建前先删除，保证渲染产物与当前管线一致。
 */

import fs from "node:fs";

for (const dir of [".astro", "node_modules/.astro"]) {
	if (fs.existsSync(dir)) {
		fs.rmSync(dir, { recursive: true, force: true });
		console.log(`[clear-astro-cache] removed ${dir}`);
	} else {
		console.log(`[clear-astro-cache] absent ${dir}`);
	}
}
