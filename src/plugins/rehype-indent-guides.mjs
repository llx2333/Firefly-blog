import {
	computeIndentGuides,
	guideLineStyle,
	INDENT_GUIDE_CLASS,
	INDENT_GUIDES_CSS,
} from "../utils/write/indent-guides.ts";

const styleCache = new WeakMap();

function classNames(node) {
	const value = node.properties?.className;
	return Array.isArray(value)
		? [...value]
		: String(value ?? "")
				.split(/\s+/)
				.filter(Boolean);
}

function findCodeWrapper(lineAst) {
	const stack = [lineAst];
	while (stack.length > 0) {
		const node = stack.pop();
		if (
			node.type === "element" &&
			node.tagName === "div" &&
			classNames(node).includes("code")
		) {
			return node;
		}
		stack.push(...(node.children ?? []));
	}
	return undefined;
}

export const indentGuidesEcPlugin = {
	name: "Indent guides",
	baseStyles: INDENT_GUIDES_CSS,
	hooks: {
		postprocessRenderedLine({ codeBlock, lineIndex, renderData }) {
			let styles = styleCache.get(codeBlock);
			if (styles === undefined) {
				styles = computeIndentGuides(
					codeBlock.getLines().map((line) => line.text),
				).map(guideLineStyle);
				styleCache.set(codeBlock, styles);
			}
			const codeWrapper = findCodeWrapper(renderData.lineAst);
			if (!codeWrapper || styles[lineIndex] === undefined) return;
			codeWrapper.properties ??= {};
			const properties = codeWrapper.properties;
			const classes = classNames(codeWrapper);
			if (!classes.includes(INDENT_GUIDE_CLASS)) {
				classes.push(INDENT_GUIDE_CLASS);
			}
			properties.className = classes;
			properties.style = [properties.style, styles[lineIndex]]
				.filter(Boolean)
				.join(";");
		},
	},
};
