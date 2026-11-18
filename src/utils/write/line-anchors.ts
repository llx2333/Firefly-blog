/**
 * 预览 HTML 的源码行号标注（批41 重写，替换 source-lines.ts 的「顶层块对位」方案）。
 *
 * 背景（批41 根因，node 探针实证）：旧方案只给**顶层元素**打 data-line。docker 笔记
 * 这类文章从某一行起整篇正文是一个 <ul>（列表项里包着几十行代码围栏），81 行文档
 * 只剩 6 个顶层锚点、最后一个锚点停在列表顶部——滚动同步对「最后锚点之后」的一切
 * 位置只能冻结在列表顶部，观感就是「左栏翻到底、右栏还在开头」。
 *
 * 新方案：在 marked 渲染期给**每个块级 token**（段落/标题/代码块/引用/列表项/表格/
 * 分隔线，含列表项内部的嵌套块）注入 data-line="源码起始行"。锚点粒度 = 渲染块级，
 * 列表内部的代码块也有锚点，插值段最短化。
 *
 * 行号求解不走 indexOf(parentRaw)（marked 会剥离列表标记/围栏缩进，实测子 token.raw
 * 在原 raw 里搜不到）：改用「首行 trim 匹配 + 整 token 逐行校验」的单调游标——每次
 * 从上次消费到的行号往后找首行，命中后把 token 的全部非空行按序逐行验一遍，通过才
 * 认行号；找不到就跳过该 token（宁缺勿错，最多该块没锚点，不会标错）。
 *
 * 为什么用 lexer + parser 两步而不是 marked.parse：行号要在渲染前算好，renderer
 * 回调拿到的 token 必须是同一批对象（探针证实 marked.parser 传的就是 lexer 产物），
 * 才能用 WeakMap 查行号。renderer 只对首个标签插一个属性，不改变渲染语义。
 *
 * 本模块只在浏览器端预览链使用；不依赖 DOM，SSR 安全。
 */

import { marked, type Token, type TokensList } from "marked";

/** 行号锚点属性名（scroll-sync.ts 同名引用） */
export const SOURCE_LINE_ATTR = "data-line";

/** 首个非空行的 trim 内容（定位游标的 needle）；整块空白返回 null */
function firstContentLine(raw: string): string | null {
	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (trimmed) return trimmed;
	}
	return null;
}

/**
 * 从 start 行起校验 raw 的全部非空行能按序对上（允许正文行间多余空行）：
 * 通过返回消费到的行后一位（下一次搜索起点），否则 null。
 */
function verifyAt(lines: string[], start: number, raw: string): number | null {
	let cursor = start;
	for (const rawLine of raw.split("\n")) {
		const trimmed = rawLine.trim();
		if (!trimmed) continue;
		let probe = cursor;
		while (probe < lines.length && lines[probe].trim() === "") probe += 1;
		if (probe >= lines.length || lines[probe].trim() !== trimmed) return null;
		cursor = probe + 1;
	}
	return cursor;
}

/** 在 lines[from..] 里定位 token 的起始行（1-based）与消费终点；找不到返回 null */
function locate(
	tok: Token,
	lines: string[],
	from: number,
): { line: number; end: number } | null {
	const needle = firstContentLine(tok.raw ?? "");
	if (!needle) return null;
	for (let i = Math.max(0, from); i < lines.length; i++) {
		if (lines[i].trim() !== needle) continue;
		const end = verifyAt(lines, i, tok.raw);
		if (end === null) continue;
		return { line: i + 1, end };
	}
	return null;
}

/**
 * 按文档序遍历 token 树，给每个块 token 记录源码起始行。
 * 容器（list / blockquote）先拿自己的起点，子 token 从容器起点再往后定位
 * （父 raw 覆盖子 raw，子不能从父的终点起搜）；兄弟按消费终点递进。
 */
function walkTokens(
	tokens: Token[],
	lines: string[],
	from: number,
	lineOf: WeakMap<Token, number>,
): number {
	let cursor = from;
	for (const tok of tokens) {
		if (tok.type === "space" || tok.type === "def") continue;
		const hit = locate(tok, lines, cursor);
		if (hit) {
			lineOf.set(tok, hit.line);
			cursor = hit.end;
		}
		const childFrom = hit ? hit.line - 1 : cursor;
		if (tok.type === "list") {
			let itemFrom = childFrom;
			for (const item of tok.items) {
				const itemHit = locate(item, lines, itemFrom);
				if (!itemHit) continue;
				lineOf.set(item, itemHit.line);
				itemFrom = itemHit.end;
				if (item.tokens?.length) {
					const [firstChild] = item.tokens;
					// 项内首个子块：源码首行带「- 」标记而子块 raw 已被 marked 剥离，
					// trim 对不上必失配（探针实证）——直接继承所在项的起始行
					//（项的首块总起始于项首行）。
					if (!locate(firstChild, lines, itemHit.line - 1)) {
						lineOf.set(firstChild, itemHit.line);
					}
					walkTokens(item.tokens, lines, itemHit.line - 1, lineOf);
				}
			}
		} else if (tok.type === "blockquote") {
			walkTokens(tok.tokens ?? [], lines, childFrom, lineOf);
		}
	}
	return cursor;
}

/** 在首个 `<tag` 后插入 data-line 属性（tag 为标签名，不含尖括号） */
function injectLine(
	html: string,
	line: number | undefined,
	tag: string,
): string {
	if (!line) return html;
	const idx = html.indexOf(`<${tag}`);
	if (idx < 0) return html;
	const at = idx + 1 + tag.length;
	return `${html.slice(0, at)} data-line="${line}"${html.slice(at)}`;
}

/**
 * markdown → 带 data-line 锚点的预览 HTML（gfm）。
 * 等价于 `marked.parse(md, { async: false, gfm: true })` + 逐块行号标注。
 */
export function renderMarkedWithLineAnchors(markdown: string): string {
	const tokens = marked.lexer(markdown, { gfm: true }) as TokensList;
	const lineOf = new WeakMap<Token, number>();
	walkTokens(tokens, markdown.split("\n"), 0, lineOf);

	const renderer = new marked.Renderer();
	const base = {
		paragraph: renderer.paragraph.bind(renderer),
		heading: renderer.heading.bind(renderer),
		code: renderer.code.bind(renderer),
		blockquote: renderer.blockquote.bind(renderer),
		listitem: renderer.listitem.bind(renderer),
		table: renderer.table.bind(renderer),
		hr: renderer.hr.bind(renderer),
	};
	renderer.paragraph = (token) =>
		injectLine(base.paragraph(token), lineOf.get(token), "p");
	renderer.code = (token) =>
		injectLine(base.code(token), lineOf.get(token), "pre");
	renderer.blockquote = (token) =>
		injectLine(base.blockquote(token), lineOf.get(token), "blockquote");
	renderer.listitem = (token) =>
		injectLine(base.listitem(token), lineOf.get(token), "li");
	renderer.table = (token) =>
		injectLine(base.table(token), lineOf.get(token), "table");
	renderer.hr = (token) => injectLine(base.hr(token), lineOf.get(token), "hr");
	renderer.heading = (token) => {
		const html = base.heading(token);
		const line = lineOf.get(token);
		if (!line) return html;
		return html.replace(/^<(h[1-6])/, `<$1 data-line="${line}"`);
	};

	return marked.parser(tokens, { gfm: true, renderer });
}

/** 供 sanity 脚本使用：md → { "行号:类型" 列表 }（不渲染） */
export function listTokenLines(markdown: string): string[] {
	const tokens = marked.lexer(markdown, { gfm: true }) as TokensList;
	const lineOf = new WeakMap<Token, number>();
	walkTokens(tokens, markdown.split("\n"), 0, lineOf);
	const out: string[] = [];
	const collect = (list: Token[]) => {
		for (const tok of list) {
			const line = lineOf.get(tok);
			if (line) out.push(`${line}:${tok.type}`);
			if (tok.type === "list") {
				for (const item of tok.items) {
					const itemLine = lineOf.get(item);
					if (itemLine) out.push(`${itemLine}:listitem`);
					collect(item.tokens ?? []);
				}
			} else if (tok.type === "blockquote") collect(tok.tokens ?? []);
		}
	};
	collect(tokens);
	return out;
}
