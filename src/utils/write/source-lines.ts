/**
 * 预览 HTML 的源码行号标注（批37：VSCode 式行号锚点滚动同步的数据层）。
 *
 * 给最终 HTML 的每个顶层块元素打 data-line="源码起始行"（1-based），滚动同步
 * （scroll-sync.ts）据此把「编辑器顶部可见行」映射到「预览对应位置」——两侧
 * 滚动距离各按各的内容高度换算，同屏内容保持对应。
 *
 * 为什么在整条预览链之后注入（而不是 marked 渲染期打标记）：
 * - hoistCodeLanguages 把 <pre><code class="language-x"> 重包成 <div class="code-block-wrap">，
 *   链中打的属性会被它的正则整体替换破坏；
 * - sanitizeHtml 会剥掉白名单外的属性。
 * 因此这里拿「链末成品 HTML」+ 「body 的 lexer 行号表」做一次 DOM 顶层对位：
 * 顶层 token 逐个试渲染、数出各自产出的顶层元素个数，按序给最终 HTML 的顶层
 * 元素分配行号（html token 一个可产出多个顶层元素，必须数不能猜）。
 *
 * 可靠性守卫（宁缺勿错，任何一步对不上都原样返回、同步自动空转）：
 * - lexer 无损性：顶层 token.raw 累计必须恰好覆盖全文，否则行号整体不可信；
 * - 结构对位：成品 HTML 顶层元素总数必须等于各 token 试渲染数之和（sanitize
 *   可能剥标签改变顶层结构），对不上说明映射基础不成立；
 * - DOMParser 仅在客户端可用：惰性创建 + 全程 try/catch，SSR / 异常路径安全。
 */

import { marked, type Token, type TokensList } from "marked";

/** 行号锚点属性名（scroll-sync.ts 同名引用） */
export const SOURCE_LINE_ATTR = "data-line";

/** 顶层块：1-based 起始源码行 → 该块在成品 HTML 里占几个顶层元素 */
interface BlockLine {
	line: number;
	count: number;
}

let domParser: DOMParser | null = null;
function getParser(): DOMParser {
	domParser ??= new DOMParser();
	return domParser;
}

function countNewlines(text: string): number {
	let n = 0;
	for (const ch of text) if (ch === "\n") n += 1;
	return n;
}

/** 单个顶层 token 独立渲染（带全文链接表，引用式链接跨块可用）；失败按空块处理 */
function renderFragment(tok: Token, links: TokensList["links"]): string {
	try {
		const arr = [tok] as TokensList;
		arr.links = links;
		return marked.parser(arr) ?? "";
	} catch {
		return "";
	}
}

function countTopElements(frag: string): number {
	if (!frag) return 0;
	return getParser().parseFromString(frag, "text/html").body.children.length;
}

/** body → 顶层块行号表；无损性守卫不过 / 异常 → null（调用方原样返回） */
function blockLineMap(body: string): BlockLine[] | null {
	try {
		// marked 内部把 \r\n 归一成 \n；按归一后的源算行号（行数与 CM 文档一致）
		const src = body.replace(/\r\n|\r/g, "\n");
		const tokens = marked.lexer(src);
		const out: BlockLine[] = [];
		let newlines = 0;
		let offset = 0;
		for (const tok of tokens) {
			const line = newlines + 1;
			offset += tok.raw.length;
			newlines += countNewlines(tok.raw);
			if (tok.type === "space") continue; // 空行块不产出元素
			const count = countTopElements(renderFragment(tok, tokens.links));
			if (!count) continue; // def 等空产出块同理跳过
			out.push({ line, count });
		}
		if (offset !== src.length) return null;
		return out;
	} catch {
		return null;
	}
}

/**
 * 给预览链成品 HTML 打 data-line。任何守卫不过都原样返回（无锚点 = 同步空转）。
 * 只新增属性 + DOM 序列化归一，渲染结果与打标前的成品逐像素等价。
 */
export function stampSourceLines(html: string, body: string): string {
	if (!html || !body) return html;
	const blocks = blockLineMap(body);
	if (!blocks) return html;
	const total = blocks.reduce((n, b) => n + b.count, 0);
	if (!total) return html;
	try {
		const doc = getParser().parseFromString(html, "text/html");
		const els = Array.from(doc.body.children);
		if (els.length !== total) return html;
		let i = 0;
		for (const b of blocks) {
			for (let k = 0; k < b.count; k++, i++) {
				els[i].setAttribute(SOURCE_LINE_ATTR, String(b.line));
			}
		}
		return doc.body.innerHTML;
	} catch {
		return html;
	}
}
