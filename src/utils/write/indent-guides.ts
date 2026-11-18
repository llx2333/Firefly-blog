/**
 * 代码块缩进竖线（VSCode 式分段参考线）——共享算法 + 样式，三端共用：
 * - 文章页：src/plugins/rehype-indent-guides.mjs 的 EC 插件（构建期 HAST 注入）
 * - /write 预览：applyIndentGuidesToMarkedHtml（客户端 marked 链后处理，
 *   WriteEditor 调用，与 hoistCodeLanguages 同层）
 * - 文章编辑页预览：同上，PostEditor 调用；样式由 posts/[...slug].astro 注入
 *
 * 批38 重写（语义逐条对齐 VSCode 官方实现；源码快照见任务目录
 * indent-guides-vscode/ref/：guidesTextModelPart.ts getLinesIndentGuides +
 * viewParts/indentGuides/indentGuides.ts）：
 * - 每行参考线条数：内容行 = ceil(缩进宽度/4)（原 floor 会漏掉未满一档的行）；
 *   纯空白行走 VSCode 区域规则（非 offSide）：上<下 = 1+floor(上/4)，相等 =
 *   ceil(下/4)，上>下 = 1+floor(下/4)，块顶/底外侧 = 0；
 * - 分段：第 k 条线只覆盖「连续行 G≥k」的行区间——`[`/`]` 等零缩进行不再被
 *   画穿（批34 整块画满即用户指出的「硬凑」「对不上」）；
 * - 第 k 条线横向位置 = 第 k 个缩进档左沿 x=(k-1)*4ch，与第 k-1 层祖先行的
 *   首字符对齐（原画在 k*4ch=本行行首，观感是给每行「关栏」而非结构 gutter）；
 *
 * 渲染形态（沿批34 的「每块一个锚点」，规避批31/32 按行分段的重叠横带）：
 * 锚点仍只有一个空 span（textContent 逐字不变），行区间写进 CSS 自定义属性，
 * ::before 用多层 background 一次画全——每段一层，层间零重叠零拼接。
 *
 * 设计约束：
 * - 缩进单位 4 空格，tab 视作 4（预览侧由本 CSS 的 pre code{tab-size:4} 保证
 *   浏览器渲染口径一致；文章页 EC 构建期已把 tab 展开成 4 空格）
 * - 行号区不画：EC 侧锚点插在首行 div.code 首位（gutter 之后）；marked 侧锚点
 *   即代码文本起点（code 无 padding，ch 与字符列严格同源）
 * - 单色竖线、低饱和、随底色自适应。底色事实（探针 2026-11-18 实证 + markdown.css
 *   注释）：编辑器预览链 pre 恒为深底（两种模式都是，prose 默认深底浅字）；文章页
 *   EC 底随主题（one-light 浅底 / one-dark-pro 深底，useDarkModeMediaQuery:false +
 *   data-theme 选择器）。故默认线色白@0.17 供深底场景；EC 浅色浅底场景由
 *   html.dark/预览链上下文规则覆盖回黑@0.14，与编辑器侧 write-surface.css 的
 *   --indent-marker-bg-color 同族。
 * - 已知退化：代码行软换行时视觉行数 > 逻辑行数，段高按逻辑行数×1lh 偏短但
 *   保持连续；不支持 lh/ch/var 多层 background 的浏览器画不出线，布局不受影响
 */

/** guide 锚点类名：EC 侧与 marked 侧产出的 DOM 形态完全一致（三端同一份 CSS） */
export const INDENT_GUIDE_CLASS = "ec-indent-guides";

/** 缩进单位（空格数），tab 按此值折算 */
export const INDENT_GUIDE_TAB_SIZE = 4;

/**
 * 单行前导空白宽度：空格 +1，tab +INDENT_GUIDE_TAB_SIZE。
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

/**
 * 逐行参考线条数（VSCode getLinesIndentGuides 语义，见文件头）：
 * 内容行 = ceil(缩进宽度/4)；空白行按上下最近内容行的区域规则；块顶/底外侧 0。
 */
export function computeGuideCounts(lines: string[]): number[] {
	const widths = lines.map(leadingIndentWidth);
	const hasContent = lines.map((text) => text.trim() !== "");
	const counts: number[] = [];
	for (let i = 0; i < lines.length; i++) {
		if (hasContent[i]) {
			counts.push(Math.ceil(widths[i] / INDENT_GUIDE_TAB_SIZE));
			continue;
		}
		let above = -1;
		for (let j = i - 1; j >= 0 && above < 0; j--) {
			if (hasContent[j]) above = widths[j];
		}
		let below = -1;
		for (let j = i + 1; j < lines.length && below < 0; j++) {
			if (hasContent[j]) below = widths[j];
		}
		if (above < 0 || below < 0) {
			counts.push(0); // 块顶/底外侧：VSCode 同样不画
		} else if (above < below) {
			counts.push(1 + Math.floor(above / INDENT_GUIDE_TAB_SIZE)); // 上方区域内部
		} else if (above === below) {
			counts.push(Math.ceil(below / INDENT_GUIDE_TAB_SIZE)); // 两区域之间
		} else {
			counts.push(1 + Math.floor(below / INDENT_GUIDE_TAB_SIZE)); // 下方区域内部
		}
	}
	return counts;
}

/** 一条参考线段：第 stop 档，从 startLine 行起连续 lineCount 行 */
export interface GuideSegment {
	stop: number;
	startLine: number;
	lineCount: number;
}

/** 行区间切分：第 k 档的每段 = 连续 G≥k 的极大行区间 */
export function computeGuideSegments(counts: number[]): GuideSegment[] {
	const max = counts.reduce((m, c) => Math.max(m, c), 0);
	const segments: GuideSegment[] = [];
	for (let stop = 1; stop <= max; stop++) {
		let start = -1;
		for (let i = 0; i <= counts.length; i++) {
			const on = i < counts.length && counts[i] >= stop;
			if (on && start < 0) start = i;
			if (!on && start >= 0) {
				segments.push({ stop, startLine: start, lineCount: i - start });
				start = -1;
			}
		}
	}
	return segments;
}

/**
 * 锚点 style 属性值（EC HAST 与 marked 锚点共用同一份生成逻辑）：
 * --ig-n     = 最大档位（::before 覆盖宽度）
 * --ig-lines = 块行数（::before 覆盖高度）
 * --ig-imgs / --ig-pos / --ig-size = 每段一层 background 的三组逗号列表
 */
export function guideAnchorStyle(
	segments: GuideSegment[],
	lineCount: number,
): string {
	const maxStop = segments.reduce((m, s) => Math.max(m, s.stop), 0);
	const imgs = segments
		.map(() => "linear-gradient(var(--ig-color), var(--ig-color))")
		.join(",");
	const pos = segments
		.map((s) => `${(s.stop - 1) * INDENT_GUIDE_TAB_SIZE}ch ${s.startLine}lh`)
		.join(",");
	const size = segments.map((s) => `1px ${s.lineCount}lh`).join(",");
	return [
		`--ig-n:${maxStop}`,
		`--ig-lines:${lineCount}`,
		`--ig-imgs:${imgs}`,
		`--ig-pos:${pos}`,
		`--ig-size:${size}`,
	].join(";");
}

/** 逐行文本 → 锚点 style 值；整块无缩进（无段）返回 null */
export function guideAnchorStyleForLines(lines: string[]): string | null {
	const segments = computeGuideSegments(computeGuideCounts(lines));
	if (segments.length === 0) return null;
	return guideAnchorStyle(segments, lines.length);
}

/**
 * 单个代码块内容（HTML，可含转义实体）→ 首行行首插块级锚点后的 HTML。
 * textContent 不变。锚点为空元素，插入后代码内容逐字原样。
 */
function applyGuidesToCodeInner(innerHtml: string): string {
	// marked 渲染的 code 内容恒以一个 \n 结尾（renderer 规范化），剥掉再数行，
	// 使 --ig-lines 与 EC 侧（getLines 已剥）逐字一致；只影响计数，textContent 不动。
	// 尾行是空白行 guide count=0，剥与不剥段/位置均不受影响（探针实证）。
	const style = guideAnchorStyleForLines(
		innerHtml.replace(/\n$/, "").split("\n"),
	);
	if (!style) return innerHtml;
	return `<span class="${INDENT_GUIDE_CLASS}" style="${style}"></span>${innerHtml}`;
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

/**
 * 共享 CSS（单份字符串三端注入）：
 * - EC 侧：作为插件 baseStyles 注入，构建期被 scoping 包进 .expressive-code，
 *   其中 html.dark 规则命中 EC 的 de-scope 逻辑（^\.expressive-code .*html → html）
 *   回归全局；
 * - /write 与文章编辑页：INDENT_GUIDES_CSS 直接 import 进 <style is:global>。
 *   （批31 起的 write.astro 手工同步副本于批38 移除——mjs/ts 本就同仓可互引。）
 *
 * 竖线画法：锚点零宽贴首行行首，::before 盖住整块（N 档宽 × 行数×1lh 高），
 * 每段一层纯色 linear-gradient：position = 档左沿 x + 段顶行 y，size = 1px×段
 * 行数——层间零重叠（批31/32 的 rgba 叠加横带结构性不存在），竖线落在第
 * 0/4/…/(N-1)*4 字符列（第 k 档左沿，与编辑器/VSCode 一致）。
 * 线色：默认白@0.17（预览链 pre 恒深底、EC 暗色深底）；html.dark 保持白；
 * EC 浅色浅底场景由 scoping 包进 .expressive-code 的默认黑@0.14 覆盖——即
 * .code-block-wrap 规则（预览链专属类，EC 块内不存在，scoped 副本为死规则）
 * 恒白，默认值恒黑，html.dark 把两侧深底场景统一拉白。
 * pre code{tab-size:4}：预览侧 tab 渲染口径与算法（tab=4）一致；文章页 EC 侧
 * tab 已在构建期展开，此规则无效果。
 */
export const INDENT_GUIDES_CSS = `
	.${INDENT_GUIDE_CLASS} {
	display: inline-block;
	width: 0;
	/* height 必须 0：inline-block 若有 1lh 高，会按自身行盒参与首行行高竞争——
	   EC 侧锚点字体继承自行容器、与代码文本 span 的字号/行高可能不一致，实测
	   把首行撑高 ~25px，其后所有参考线整体下移错位。零高度盒永不参与行高竞争，
	   ::before 仍从行盒顶定位（vertical-align: top 保证贴首行行首）。 */
	height: 0;
	vertical-align: top;
	position: relative;
	pointer-events: none;
	--ig-color: rgba(0, 0, 0, 0.14);
}

html.dark .${INDENT_GUIDE_CLASS} {
	--ig-color: rgba(255, 255, 255, 0.17);
}

/* 预览链（hoistCodeLanguages 的 .code-block-wrap）pre 恒深底：两种模式都用白线 */
.code-block-wrap .${INDENT_GUIDE_CLASS} {
	--ig-color: rgba(255, 255, 255, 0.17);
}

.${INDENT_GUIDE_CLASS}::before {
	content: '';
	position: absolute;
	left: 0;
	top: 0;
	width: calc(var(--ig-n, 0) * ${INDENT_GUIDE_TAB_SIZE}ch + 1px);
	height: calc(var(--ig-lines, 1) * 1lh);
	background-image: var(--ig-imgs, none);
	background-position: var(--ig-pos, 0 0);
	background-size: var(--ig-size, 0 0);
	background-repeat: no-repeat;
}

pre code {
	tab-size: 4;
}
`;
