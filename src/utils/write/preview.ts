/**
 * 编辑器预览的代码块语言徽章。读者侧的语言徽章由 expressive-code-language-badge
 * 在构建期渲染（[data-language]::before），编辑器预览走 marked 纯输出没有这层，
 * 语言信息只留在 <code class="language-x"> 的 class 里、肉眼不可见。
 *
 * 这里把语言提到外层包裹 div 的 data-language 属性上，徽章本体交给
 * markdown.css 的 .code-block-wrap::before 绘制（配色与读者侧同一组主题变量）。
 * 代码内容里的 </code></pre> 已被 marked 转义成实体，非贪婪匹配不会跨块截断。
 */
export function hoistCodeLanguages(html: string): string {
	return html.replace(
		/<pre><code class="language-([^"]*)">([\s\S]*?)<\/code><\/pre>/g,
		(_raw, lang: string, code: string) =>
			`<div class="code-block-wrap" data-language="${lang}"><pre><code>${code}</code></pre></div>`,
	);
}
