import { pinyin } from "pinyin-pro";

/**
 * 文件名 → slug 转换，照抄 scripts/new-post.js 的算法：
 * 去扩展名、去尾部 /index；含中文的路径段逐字转无声调拼音（pinyin-pro toneType:"none"），
 * 非中文字符原样保留；段内以 "-" 连接后统一小写、剔除非 [a-z0-9-] 字符、合并连续 "-"、去首尾 "-"；
 * 纯英文段原样返回（与 new-post.js 行为一致）。
 */

const fileExtensionRegex = /\.(md|mdx)$/i;

export function fileNameToSlug(fileName: string): string {
	let slug = fileName.replace(fileExtensionRegex, "");
	if (slug.endsWith("/index")) {
		slug = slug.slice(0, -"/index".length);
	}
	return slug
		.split("/")
		.map((segment) => {
			if (!/[一-鿿]/.test(segment)) return segment;
			// 逐字符处理：中文 → 拼音，其他 → 保留
			const chars = [...segment];
			const parts: string[] = [];
			let buf = "";
			for (const ch of chars) {
				if (/[一-鿿]/.test(ch)) {
					if (buf) {
						parts.push(buf);
						buf = "";
					}
					parts.push(pinyin(ch, { toneType: "none", type: "array" })[0]);
				} else {
					buf += ch;
				}
			}
			if (buf) parts.push(buf);
			return parts
				.join("-")
				.toLowerCase()
				.replace(/[^a-z0-9-]/g, "")
				.replace(/-+/g, "-")
				.replace(/^-|-$/g, "");
		})
		.join("/");
}

/** 本地时区 YYYY-MM-DD（new-post.js 的 getDate 同款） */
export function todayDateString(): string {
	const now = new Date();
	const year = now.getFullYear();
	const month = String(now.getMonth() + 1).padStart(2, "0");
	const day = String(now.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

/** 媒体文件时间戳前缀：YYYYMMDD-HHmmss */
export function timestampPrefix(): string {
	const now = new Date();
	const p = (n: number, len = 2) => String(n).padStart(len, "0");
	return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(
		now.getHours(),
	)}${p(now.getMinutes())}${p(now.getSeconds())}`;
}
