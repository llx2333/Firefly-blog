/** Shared indentation columns and per-line paint for article, preview and CM. */
export const INDENT_GUIDE_CLASS = "ec-indent-guides";
export const INDENT_GUIDE_TAB_SIZE = 4;

function leadingIndent(line: string, tabSize: number): number {
	let column = 0;
	for (const char of line) {
		if (char === " ") column++;
		else if (char === "\t") column += tabSize - (column % tabSize);
		else break;
	}
	return column;
}

/** Ancestor columns only; no common-indent removal or synthetic tab-size levels. */
export function computeIndentGuides(
	lines: readonly string[],
	tabSize: number = INDENT_GUIDE_TAB_SIZE,
): number[][] {
	const size = Number.isInteger(tabSize) && tabSize > 0 ? tabSize : 4;
	const result: number[][] = lines.map(() => []);
	const stack: number[] = [];
	let previousIndent = 0;
	let previousLine = -1;

	for (let index = 0; index < lines.length; index++) {
		if (lines[index].trim() === "") continue;
		const column = leadingIndent(lines[index], size);
		while (stack.length > 0 && stack[stack.length - 1] >= column) {
			stack.pop();
		}
		if (previousLine >= 0 && previousIndent < column) {
			stack.push(previousIndent);
		}
		result[index] = [...stack];

		if (previousLine >= 0) {
			// A dedent ends its inner guides before the preceding blank lines.
			for (let blank = previousLine + 1; blank < index; blank++) {
				result[blank] = [...result[index]];
			}
		}
		previousIndent = column;
		previousLine = index;
	}
	return result;
}

export function guideLineStyle(columns: readonly number[]): string {
	if (columns.length === 0) return "--igi:none;--igx:0 0";
	const images = columns.map(() => "var(--ig)").join(",");
	const positions = columns
		.map(
			(column) => `calc(${column + 0.5}ch + var(--ig-offset, 0px) - 0.5px) 0`,
		)
		.join(",");
	return `--igi:${images};--igx:${positions}`;
}

export const INDENT_GUIDES_CSS = `
.ec-indent-guides,
.preview-code-line {
	--ig-color: rgba(0, 0, 0, 0.14);
}

html.dark .ec-indent-guides,
html.dark .preview-code-line {
	--ig-color: rgba(255, 255, 255, 0.17);
}

.code-block-wrap .preview-code-line {
	--ig-color: rgba(255, 255, 255, 0.17);
}

.ec-indent-guides,
.preview-code-line,
.cm-indent-guides {
	--ig: linear-gradient(var(--ig-color), var(--ig-color));
	background-image: var(--igi, none);
	background-position: var(--igx, 0 0);
	background-size: 1px 100%;
	background-repeat: no-repeat;
	background-origin: content-box;
}

.ec-indent-guides {
	--ig-offset: calc(var(--ecIndent, 0ch) * -1);
}

body.wallpaper-transparent .frame .ec-line .code.ec-indent-guides {
	background-image: var(--igi, none) !important;
	background-position: var(--igx, 0 0) !important;
	background-size: 1px 100% !important;
	background-repeat: no-repeat !important;
	background-origin: content-box !important;
}

.preview-code-line {
	display: block;
	min-height: 1lh;
}

pre code {
	tab-size: 4;
}
`;
