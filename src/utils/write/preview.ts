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

/**
 * 每行前导空白里的 tab 按 CommonMark 折进 4 列制表位（空格照常计数）。
 *
 * marked 不按 CommonMark 处理前导 tab：实测它把 tab 当 1 字符展开再剥围栏缩进
 * （`\t    {` 在 2 空格围栏下 → 3 空格），行首 tab 的代码块预览缩进整体错位。
 * 文章页走 remark（CommonMark 正确）：先把前导 tab 按制表位展开成空格，marked
 * 剥完围栏缩进的列数与 remark 逐列一致。已知边界：tab 缩进的结束围栏（\t```)
 * 经展开后 ≥4 列，marked 的闭合正则（≤3 空格）仍不认、会把后续正文吞进代码块
 * （文章页 remark 按列剥除后能正确闭合）——根治要靠源内容不用 tab 缩进围栏。
 * 非前导位置的 tab 不动（代码内容里的 tab 由共享 CSS 的 pre code{tab-size:4}
 * 负责渲染）。
 */
export function expandLeadingTabs(markdown: string): string {
	return markdown.replace(/^[\t ]+/gm, (lead) => {
		let width = 0;
		let out = "";
		for (const ch of lead) {
			if (ch === "\t") {
				const next = (Math.floor(width / 4) + 1) * 4;
				out += " ".repeat(next - width);
				width = next;
			} else {
				out += ch;
				width += 1;
			}
		}
		return out;
	});
}
