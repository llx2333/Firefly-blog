/**
 * 代码块缩进竖线（VSCode 非活动参考线式）——共享算法 + 样式，双端共用：
 * - 文章页：src/plugins/rehype-indent-guides.mjs 里的 EC 插件（构建期 HAST 注入）
 * - 编辑器预览：本文件导出的 applyIndentGuidesToMarkedHtml（客户端 marked 链后处理，
 *   由 WriteEditor / PostEditor 的 preview derived 调用，与 hoistCodeLanguages 同层）
 *
 * 批34 重写（容器级连续线）：批31/32 的「每行一个锚点段」结构有结构性缺陷——
 * 行与行之间是各自独立的线段，靠 ::before 下延 0.3em 重叠补口，而半透明色在
 * 重叠处必然加深（rgba 叠加），每行交界出现更亮的横带，视觉上就是「每行一条
 * 拼起来的」。重写为「每块一个锚点」：锚点只插在块首行行首，::before 以
 * calc(行数 * 1lh) 一次画满整块高度——一条伪元素从块顶贯通到块底，零重叠
 * 零拼接；线覆盖全块（VSCode 非活动参考线形态，空行/闭合行所在列也有线）。
 *
 * 设计约束：
 * - 缩进单位 4 空格，tab 视作 4（不做 tab-stop 进位）
 * - 纯装饰：锚点为空元素，插入后 <pre> 的 textContent 逐字不变（复制/导出原样）
 * - 行号区不画：EC 侧锚点插在首行 div.code 首位（gutter 之后）；marked 侧锚点
 *   即代码文本起点（code 无 padding，ch 与字符列严格同源）
 * - 单色竖线、低饱和、随站点明暗自适应（html.dark），配色与编辑器侧
 *   write-surface.css 的 --indent-marker-bg-color 同族（rgba 黑 0.14 / 白 0.17）
 * - 已知退化：长行 wrap 时块高 > 行数×行高，线画不到块底但保持连续不断；
 *   不支持 lh 单位的浏览器画不出线，布局不受影响
 */

/** guide 锚点类名：EC 侧与 marked 侧产出的 DOM 形态完全一致（两端同一份 CSS） */
export const INDENT_GUIDE_CLASS = "ec-indent-guides";

/** 缩进单位（空格数），tab 按此值折算 */
export const INDENT_GUIDE_TAB_SIZE = 4;

/**
 * 单行前导空白宽度：空格 +1，tab +INDENT_GUIDE_TAB_SIZE（tab 视作 4 空格）。
 * 首个非空白字符处停止。输入可以是转义后的 HTML（空格/tab 永不被转义）。
 */
function leadingIndentWidth(lineText: string): number {
	let width = 0;
	for (const ch of lineText) {
		if (ch === " ") {
			width += 1;
		} else if (ch === "\t") {
			width += INDENT_GUIDE_TAB_SIZE;
		} else {
			break;
		}
	}
	return width;
}

/** 单行缩进层级：前导空白宽度对缩进单位向下取整；0 = 顶级不画线 */
function computeIndentLevel(lineText: string): number {
	return Math.floor(leadingIndentWidth(lineText) / INDENT_GUIDE_TAB_SIZE);
}

/**
 * 整块逐行计算缩进层级。空行（含纯空白行）继承前后最近非空行层级的较小值，
 * 与 VSCode 行为近似；两侧缺任一则视为 0。
 */
export function computeIndentLevels(lines: string[]): number[] {
	const levels = lines.map((text) => computeIndentLevel(text));
	for (let i = 0; i < levels.length; i++) {
		if (lines[i].trim() !== "") continue;
		let prev = 0;
		for (let j = i - 1; j >= 0; j--) {
			if (lines[j].trim() !== "") {
				prev = levels[j];
				break;
			}
		}
		let next = 0;
		for (let j = i + 1; j < levels.length; j++) {
			if (lines[j].trim() !== "") {
				next = levels[j];
				break;
			}
		}
		levels[i] = Math.min(prev, next);
	}
	return levels;
}

/**
 * 块级 guide 锚点（每块仅一个，插在首行行首）：
 * --ig-n  = 块内最大缩进层级（决定画几条线，第 4/8/…/N*4 字符列）
 * --ig-lines = 块行数（决定 ::before 画满整块高度：lines * 1lh）
 */
export function guideAnchorHtml(maxLevel: number, lineCount: number): string {
	return `<span class="${INDENT_GUIDE_CLASS}" style="--ig-n:${maxLevel};--ig-lines:${lineCount}"></span>`;
}

/**
 * 共享 CSS（单份字符串双端注入）：
 * - EC 侧：作为插件 baseStyles 注入，构建期被 scoping 包进 .expressive-code，
 *   其中 html.dark 规则命中 EC 的 de-scope 逻辑（^\.expressive-code .*html → html）
 *   回归全局；
 * - 预览侧：同一字符串在 write 页样式表手工同步（mjs/ts 双环境无法互引）。
 *
 * 竖线画法：锚点零宽贴首行行首，::before 横向铺 N*4ch 宽、纵向铺行数*1lh 高，
 * repeating-gradient 每 4ch 末尾画 1px——竖线落在第 4/8/…/N*4 字符列
 * （层级 1..N，与编辑器侧一致，第 0 列不画），一条伪元素画完全部线。
 */
export const INDENT_GUIDES_CSS = `
.${INDENT_GUIDE_CLASS} {
	display: inline-block;
	width: 0;
	height: 1lh;
	vertical-align: top;
	position: relative;
	pointer-events: none;
	--ig-color: rgba(0, 0, 0, 0.14);
}

html.dark .${INDENT_GUIDE_CLASS} {
	--ig-color: rgba(255, 255, 255, 0.17);
}

.${INDENT_GUIDE_CLASS}::before {
	content: '';
	position: absolute;
	left: 0;
	top: 0;
	height: calc(var(--ig-lines, 1) * 1lh);
	width: calc(var(--ig-n, 0) * ${INDENT_GUIDE_TAB_SIZE}ch);
	background-image: repeating-linear-gradient(
		to right,
		transparent 0 calc(${INDENT_GUIDE_TAB_SIZE}ch - 1px),
		var(--ig-color) calc(${INDENT_GUIDE_TAB_SIZE}ch - 1px) ${INDENT_GUIDE_TAB_SIZE}ch
	);
}
`;

/**
 * 单个代码块内容（HTML，可含转义实体）→ 首行行首插块级锚点后的 HTML。
 * maxLevel ≤ 0（整块无缩进）不插。textContent 不变。
 */
function applyGuidesToCodeInner(innerHtml: string): string {
	const lines = innerHtml.split("\n");
	const levels = computeIndentLevels(lines);
	const maxLevel = Math.max(...levels);
	if (maxLevel <= 0) return innerHtml;
	return `${guideAnchorHtml(maxLevel, lines.length)}${innerHtml}`;
}

/**
 * marked 输出 HTML 的缩进竖线后处理：对每个 <pre><code>…</code></pre> 块首插锚点。
 * 在 hoistCodeLanguages 之前或之后调用均可（正则不依赖外层包裹结构）。
 * 代码内容是转义后的 HTML：&lt; &amp; 等实体不影响前导空白判定。
 */
export function applyIndentGuidesToMarkedHtml(html: string): string {
	return html.replace(
		/<pre><code([^>]*)>([\s\S]*?)<\/code><\/pre>/g,
		(_raw, codeAttrs: string, inner: string) =>
			`<pre><code${codeAttrs}>${applyGuidesToCodeInner(inner)}</code></pre>`,
	);
}
