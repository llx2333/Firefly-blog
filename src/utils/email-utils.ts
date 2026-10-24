/**
 * 邮箱链接 base64 加密工具，防止爬虫直接抓取邮箱地址。
 *
 * 用法（Profile / 横幅 / 导航下拉 / 移动抽屉统一约定）：
 * - 渲染时：data-email 用 encodeMailto(url) 的返回值，并加 data-email-trigger；
 * - 点击时：全站共用的 common/EmailDialog.astro 委托脚本解码并弹出「展示+复制」弹窗，
 *   不再直接唤起邮件客户端。
 */

// 加密邮箱（去掉 "mailto:" 前缀后 base64 编码，SSR 侧使用）
export function encodeMailto(url: string): string {
	return Buffer.from(url.replace("mailto:", "")).toString("base64");
}
