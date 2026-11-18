import { fromHtml } from "hast-util-from-html";
import { toHtml } from "hast-util-to-html";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { defaultHandlers, type State, toHast } from "mdast-util-to-hast";
import { gfm } from "micromark-extension-gfm";
import sanitizeHtml from "sanitize-html";
import { localizePreviewImages } from "./images";
import { computeIndentGuides, guideLineStyle } from "./indent-guides";
import { SOURCE_LINE_ATTR } from "./line-anchors";

type MarkdownNode = Parameters<typeof toHast>[0];
type CodeNode = Extract<MarkdownNode, { type: "code" }>;
type HtmlNode = ReturnType<typeof toHast>;
type HtmlElement = Extract<HtmlNode, { type: "element" }>;

const BLOCK_TYPES = new Set<MarkdownNode["type"]>([
	"blockquote",
	"heading",
	"paragraph",
	"list",
	"listItem",
	"code",
	"thematicBreak",
	"table",
	"tableRow",
	"tableCell",
	"footnoteDefinition",
]);

const sanitizeConfig: sanitizeHtml.IOptions = {
	allowedTags: [
		...sanitizeHtml.defaults.allowedTags,
		"img",
		"input",
		"del",
		"ins",
		"mark",
		"figure",
		"figcaption",
		"kbd",
		"sup",
		"sub",
	],
	allowedAttributes: {
		...sanitizeHtml.defaults.allowedAttributes,
		"*": [SOURCE_LINE_ATTR],
		a: ["href", "title", "target", "rel"],
		img: ["src", "alt", "title", "width", "height", "loading"],
		input: ["type", "checked", "disabled"],
		code: ["class"],
		span: ["class"],
		pre: ["class"],
		div: ["class", "data-language"],
	},
	allowedSchemes: ["http", "https", "mailto", "blob"],
};

function lineProperties(node: MarkdownNode): HtmlElement["properties"] {
	const line = node.position?.start.line;
	return line ? { [SOURCE_LINE_ATTR]: line } : {};
}

function annotateBlocks(node: MarkdownNode): void {
	if (BLOCK_TYPES.has(node.type)) {
		node.data = {
			...node.data,
			hProperties: { ...node.data?.hProperties, ...lineProperties(node) },
		};
	}
	if ("children" in node) {
		for (const child of node.children) annotateBlocks(child);
	}
}

function renderCode(
	state: State,
	node: CodeNode,
	markdown: string,
): HtmlElement {
	const start = node.position?.start;
	// The parser's offset points at the fence itself, even inside lists/quotes.
	const fenced =
		start?.offset !== undefined &&
		/^(?:`{3}|~{3})/.test(markdown.slice(start.offset, start.offset + 3));
	const firstLine = (start?.line ?? 1) + (fenced ? 1 : 0);
	const lines = node.value.split(/\r\n?|\n/);
	const code: HtmlElement = {
		type: "element",
		tagName: "code",
		properties: {},
		children: lines.map((line, index) => ({
			type: "element",
			tagName: "span",
			properties: {
				className: ["preview-code-line"],
				[SOURCE_LINE_ATTR]: firstLine + index,
			},
			// Keep newlines inside each row, never between block-level spans.
			children: [{ type: "text", value: node.value ? `${line}\n` : "" }],
		})),
	};
	const pre: HtmlElement = {
		type: "element",
		tagName: "pre",
		properties: lineProperties(node),
		children: [code],
	};
	const wrapper: HtmlElement = {
		type: "element",
		tagName: "div",
		properties: { className: ["code-block-wrap"], ...lineProperties(node) },
		children: [pre],
	};
	const language = node.lang?.split(/\s+/)[0];
	if (language) wrapper.properties.dataLanguage = language;
	state.patch(node, wrapper);
	return wrapper;
}

function textContent(node: HtmlNode): string {
	if (node.type === "text") return node.value;
	return "children" in node ? node.children.map(textContent).join("") : "";
}

function isCodeLine(node: HtmlNode): node is HtmlElement {
	return (
		node.type === "element" &&
		node.tagName === "span" &&
		Array.isArray(node.properties.className) &&
		node.properties.className.includes("preview-code-line")
	);
}

function addIndentGuides(node: HtmlNode): void {
	if (node.type === "element" && node.tagName === "pre") {
		for (const child of node.children) {
			if (child.type !== "element" || child.tagName !== "code") continue;
			const rows = child.children.filter(isCodeLine);
			const guides = computeIndentGuides(
				rows.map((row) => textContent(row).replace(/\n$/, "")),
				4,
			);
			for (let index = 0; index < rows.length; index++) {
				const style = guideLineStyle(guides[index]);
				if (style) rows[index].properties.style = style;
			}
		}
	}
	if ("children" in node) {
		for (const child of node.children) addIndentGuides(child);
	}
}

/** CommonMark/GFM preview with exact source anchors and sanitized HTML. */
export function renderPreview(
	markdown: string,
	resolver: (url: string) => string | null,
): string {
	const tree = fromMarkdown(markdown, {
		extensions: [gfm()],
		mdastExtensions: [gfmFromMarkdown()],
	});
	annotateBlocks(tree);
	const hast = toHast(tree, {
		allowDangerousHtml: true,
		handlers: {
			code: (state, node: CodeNode) => renderCode(state, node, markdown),
			html: (state, node, parent) => {
				const raw = defaultHandlers.html(state, node);
				const line = node.position?.start.line;
				// Anchor a block's opening tag without reparsing partial raw HTML.
				if (raw?.type === "raw" && line && parent?.type !== "paragraph") {
					raw.value = raw.value.replace(
						/^([ \t]*<[a-z][a-z\d:-]*)(?=[\s/>])/i,
						`$1 ${SOURCE_LINE_ATTR}="${line}"`,
					);
				}
				return raw;
			},
			paragraph: (state, node, parent) => {
				const paragraph = defaultHandlers.paragraph(state, node);
				// Tight lists unwrap <p>; keep its anchor on an inline child.
				if (parent?.type === "listItem" && paragraph?.type === "element") {
					paragraph.children = [
						{
							type: "element",
							tagName: "span",
							properties: lineProperties(node),
							children: paragraph.children,
						},
					];
				}
				return paragraph;
			},
		},
	});
	const html = localizePreviewImages(
		toHtml(hast, { allowDangerousHtml: true }),
		resolver,
	);
	const sanitized = fromHtml(sanitizeHtml(html, sanitizeConfig), {
		fragment: true,
	});
	// User CSS is stripped first; only shared, numeric guide styles are added.
	addIndentGuides(sanitized);
	return toHtml(sanitized);
}
