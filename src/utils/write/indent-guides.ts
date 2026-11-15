/**
 * 代码块缩进竖线（VSCode 式）——共享算法 + 样式，双端共用：
 * - 文章页：src/plugins/rehype-indent-guides.mjs 里的 EC 插件（构建期 HAST 注入）
 * - 编辑器预览：本文件导出的 applyIndentGuidesToMarkedHtml（客户端 marked 链后处理，
 *   由集成阶段接进 WriteEditor 的 preview derived，与 hoistCodeLanguages 同层）
 *
 * 设计约束（批31 §2）：
 * - 缩进单位 4 空格，tab 视作 4（不做 tab-stop 进位）
 * - 纯装饰：锚点 span 为空元素，插入后 <pre> 的 textContent 逐字不变（复制/导出原样）
 * - 行号区不画：EC 侧锚点插在 div.code 首位（gutter 之后）；marked 侧每行行首即代码起点
 * - 单色竖线、低饱和、随站点明暗自适应（html.dark），配色与编辑器侧
 *   write-surface.css 的 --indent-marker-bg-color 同族（rgba 黑 0.14 / 白 0.17）
 * - 优雅降级：不支持 lh 单位的浏览器锚点高度归零，画不出线但布局不受影响
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
 * 让引导线在空行上连续（VSCode 行为近似）；两侧缺任一则视为 0。
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
 * guide 锚点 span 的 HTML（marked 字符串链用）。零宽 inline-block 锚点，
 * 竖线由 ::before 按层级画在锚点右侧 4ch 的整数倍处（见 INDENT_GUIDES_CSS）。
 */
export function guideSpanHtml(level: number): string {
	return `<span class="${INDENT_GUIDE_CLASS}" style="--ig-n:${level}"></span>`;
}

/**
 * 共享 CSS（单份字符串双端注入）：
 * - EC 侧：作为插件 baseStyles 注入，构建期被 scoping 包进 .expressive-code，
 *   其中 html.dark 规则命中 EC 的 de-scope 逻辑（^\.expressive-code .*html → html）
 *   回归全局，压得住嵌套展开后的默认变量；
 * - 预览侧：集成阶段引入同一字符串（write 页样式表），同样的 html.dark 覆盖直接生效。
 *
 * 竖线画法：锚点零宽贴行首，::before 横向铺 N*4ch 宽，repeating-gradient 每 4ch
 * 末尾画 1px——即竖线落在第 4/8/…/N*4 字符列（层级 1..N，与编辑器侧一致，第 0 列不画）。
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
	height: 100%;
	width: calc(var(--ig-n, 0) * ${INDENT_GUIDE_TAB_SIZE}ch);
	background-image: repeating-linear-gradient(
		to right,
		transparent 0 calc(${INDENT_GUIDE_TAB_SIZE}ch - 1px),
		var(--ig-color) calc(${INDENT_GUIDE_TAB_SIZE}ch - 1px) ${INDENT_GUIDE_TAB_SIZE}ch
	);
}
`;

/** 单个代码块内容（HTML，可含转义实体）→ 逐行行首插锚点后的 HTML。textContent 不变。 */
function applyGuidesToCodeInner(innerHtml: string): string {
	const lines = innerHtml.split("\n");
	const levels = computeIndentLevels(lines);
	return lines
		.map((line, i) =>
			levels[i] > 0 ? `${guideSpanHtml(levels[i])}${line}` : line,
		)
		.join("\n");
}

/**
 * marked 输出 HTML 的缩进竖线后处理：对每个 <pre><code>…</code></pre> 逐行注入锚点。
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
