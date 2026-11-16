/**
 * 文章页代码块缩进竖线（VSCode 式）——Expressive Code 插件（构建期，批31 轨道A）。
 *
 * 路径选型依据（dev 实测 + 源码级验证，2026-11-15）：
 * 1. 本仓库 markdown.processor 用 @astrojs/markdown-remark 的 unified()（astro.config.mjs），
 *    astro-expressive-code 0.44.2 对此形态把 rehypeExpressiveCode push 到
 *    markdownProcessor.options.rehypePlugins 的数组末尾（dist/index.js:511-513）——
 *    在 markdown.rehypePlugins 里追加的后处理插件只会先于 EC 执行，看到的是
 *    <pre><code> 原始形态而非 figure.frame > pre > .ec-line，路径①（rehype 后处理
 *    跑在 EC 之后）在不做集成顺序 hack 的前提下不成立。
 * 2. EC 0.44.2 暴露渲染期 hook：postprocessRenderedLine 逐行提供 line（只读源码）
 *    与 renderData.lineAst（HAST，可改），并支持插件级 baseStyles 注入——
 *    官方 API、必然发生在块渲染之后、HAST 操作结构安全，选此路径（②）。
 * 3. 实测渲染结构（dev /posts/code-examples/）：
 *    div.expressive-code > (div.ec-collapse*) > figure.frame > pre[data-language]
 *    > code > div.ec-line > [div.gutter > div.ln 行号, div.code 代码体]。
 *
 * 约束：锚点 span 为空元素（textContent 逐字不变），每块仅插一个、插在首行
 * div.code 首位（行号区不画），::before 以 calc(行数 * 1lh) 画满整块高度——
 * 容器级连续线（批34 重写，机理见 indent-guides.ts 头注释）；算法与样式与本仓库
 * src/utils/write/indent-guides.ts 单源共享，保证文章页与编辑器预览两端一致。
 * 文件名沿用任务书清单（rehype- 前缀为历史命名）。
 *
 * tab 缩进前置事实（2026-11-15 dev 探针定位）：tab→空格的展开发生在
 * rehype-expressive-code（astro-expressive-code 的 rehype 层，默认 tabWidth=2），
 * remark/rehype 全管线（remark-parse/remark-rehype/站点插件逐层探针）均原样保留
 * tab；根因与修复（EC 配置 tabWidth: 4）见 astro.config.mjs expressiveCode() 注释。
 */

import {
	computeIndentLevels,
	INDENT_GUIDE_CLASS,
	INDENT_GUIDES_CSS,
} from "../utils/write/indent-guides.ts";

/** 同一 codeBlock 的行层级只算一次（hook 按行触发，逐行重算会退化为 O(n²)） */
const levelsCache = new WeakMap();

function getBlockIndentLevels(codeBlock) {
	let levels = levelsCache.get(codeBlock);
	if (!levels) {
		levels = computeIndentLevels(codeBlock.getLines().map((line) => line.text));
		levelsCache.set(codeBlock, levels);
	}
	return levels;
}

/** 在行 AST（div.ec-line）里找代码体 div.code（gutter 之后）；找不到返回 undefined */
function findCodeWrapper(lineAst) {
	const stack = [lineAst];
	while (stack.length > 0) {
		const node = stack.shift();
		for (const child of node.children ?? []) {
			if (child.type !== "element") continue;
			const classNames = Array.isArray(child.properties?.className)
				? child.properties.className
				: String(child.properties?.className ?? "").split(/\s+/);
			if (classNames.includes("code")) return child;
			stack.push(child);
		}
	}
	return undefined;
}

/**
 * EC 插件本体。接入位置：astro.config.mjs expressiveCode({ plugins: [..., 本插件] })
 * 放在末尾，保证在行号等插件的行渲染之后执行。
 */
export const indentGuidesEcPlugin = {
	name: "Indent guides",
	baseStyles: INDENT_GUIDES_CSS,
	hooks: {
		postprocessRenderedLine(context) {
			const { codeBlock, lineIndex, renderData } = context;
			// 每块只在首行插一次锚点（容器级连续线：一条 ::before 画满整块高度）
			if (lineIndex !== 0) return;
			const levels = getBlockIndentLevels(codeBlock);
			const maxLevel = Math.max(...levels);
			if (maxLevel <= 0) return;
			const codeWrapper = findCodeWrapper(renderData.lineAst);
			if (!codeWrapper) return;
			codeWrapper.children.unshift({
				type: "element",
				tagName: "span",
				properties: {
					className: [INDENT_GUIDE_CLASS],
					style: `--ig-n: ${maxLevel}; --ig-lines: ${codeBlock.getLines().length}`,
				},
				children: [],
			});
		},
	},
};
