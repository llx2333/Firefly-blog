import assert from "node:assert/strict";
import test from "node:test";
import type { Element, Root, RootContent } from "hast";
import { fromHtml } from "hast-util-from-html";
import { renderPreview } from "./preview";

type Node = Root | RootContent;

function elements(node: Node, tagName: string): Element[] {
	const result: Element[] = [];
	if (node.type === "element" && node.tagName === tagName) result.push(node);
	if ("children" in node) {
		for (const child of node.children) result.push(...elements(child, tagName));
	}
	return result;
}

function text(node: Node): string {
	if (node.type === "text") return node.value;
	return "children" in node ? node.children.map(text).join("") : "";
}

function parse(markdown: string): Root {
	return fromHtml(
		renderPreview(markdown, () => null),
		{ fragment: true },
	);
}

function codeRows(root: Root): Element[] {
	return elements(root, "span").filter((node) =>
		(node.properties.className as string[] | undefined)?.includes(
			"preview-code-line",
		),
	);
}

test("repeated paragraphs have their own exact source lines", () => {
	const root = parse("same\n\nsame\n\n# same\n\nsame");
	assert.deepEqual(
		elements(root, "p").map((node) => node.properties.dataLine),
		["1", "3", "7"],
	);
	assert.equal(elements(root, "h1")[0].properties.dataLine, "5");
});

test("nested fenced code preserves text and anchors each code line", () => {
	const root = parse(
		'- item\n\n  ```json\n  [\n      {\n          "key": 1\n      }\n  ]\n  ```',
	);
	assert.deepEqual(
		codeRows(root).map((node) => node.properties.dataLine),
		["4", "5", "6", "7", "8"],
	);
	assert.equal(
		text(elements(root, "code")[0]),
		'[\n    {\n        "key": 1\n    }\n]\n',
	);
	assert.match(String(codeRows(root)[2].properties.style), /4\.5ch/);
});

test("quoted fences and indented code use their actual first content lines", () => {
	const root = parse("> ```text\n> same\n> ```\n\n    same\n    next");
	assert.deepEqual(
		codeRows(root).map((node) => node.properties.dataLine),
		["2", "5", "6"],
	);
	assert.equal(text(elements(root, "code")[1]), "same\nnext\n");
});

test("blank rows and literal HTML in code retain exact text", () => {
	const root = parse("~~~html\n<div>\n\n  x\n</div>\n~~~");
	assert.equal(codeRows(root).length, 4);
	assert.equal(text(elements(root, "code")[0]), "<div>\n\n  x\n</div>\n");
	assert.equal(elements(root, "script").length, 0);
});

test("GFM tables, task lists and strikethrough survive sanitization", () => {
	const root = parse(
		"- [x] done\n\n| key | value |\n| --- | --- |\n| a | b |\n\n~~old~~",
	);
	assert.equal(elements(root, "input")[0].properties.type, "checkbox");
	assert.equal(elements(root, "input")[0].properties.disabled, true);
	assert.equal(elements(root, "table").length, 1);
	assert.equal(elements(root, "del").length, 1);
});

test("unsafe HTML, URL schemes and user CSS are removed", () => {
	const root = parse(
		'<script>alert(1)</script>\n\n<a href="javascript:alert(1)" onclick="alert(1)">bad</a>\n\n<img src="javascript:alert(1)" onerror="alert(1)">\n\n<span style="position:fixed">text</span>',
	);
	assert.equal(elements(root, "script").length, 0);
	for (const tag of ["a", "img", "span"]) {
		for (const node of elements(root, tag)) {
			assert.equal(node.properties.onClick, undefined);
			assert.equal(node.properties.onError, undefined);
			assert.equal(node.properties.style, undefined);
			assert.doesNotMatch(
				String(node.properties.href ?? node.properties.src ?? ""),
				/javascript:/i,
			);
		}
	}
});

test("image localization receives decoded URLs and supports local blobs", () => {
	const html = renderPreview("![pic](/assets/a%20b.png)", (url) =>
		url === "/assets/a b.png" ? "blob:local-image" : null,
	);
	const root = fromHtml(html, { fragment: true });
	assert.equal(elements(root, "img")[0].properties.src, "blob:local-image");
});

test("empty and unclosed fenced documents render without exceptions", () => {
	assert.equal(
		renderPreview("", () => null),
		"",
	);
	const root = parse("```js\nconst value = 1;");
	assert.equal(text(elements(root, "code")[0]), "const value = 1;\n");
	assert.equal(codeRows(root)[0].properties.dataLine, "2");
});
