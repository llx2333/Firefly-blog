import {
	countColumn,
	type EditorState,
	type Extension,
	RangeSetBuilder,
	StateField,
} from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import { computeIndentGuides, guideLineStyle } from "./indent-guides";

/** State-owned line decorations also provide hanging indent when guides are off. */
export function cmIndentGuides({
	enabled = true,
	wrap = true,
}: {
	enabled?: boolean;
	wrap?: boolean;
} = {}): Extension {
	if (!enabled && !wrap) return [];

	function build(state: EditorState): DecorationSet {
		const lines = state.doc.toString().split("\n");
		const columns = enabled ? computeIndentGuides(lines, state.tabSize) : [];
		const builder = new RangeSetBuilder<Decoration>();
		let from = 0;
		for (let index = 0; index < lines.length; index++) {
			const style: string[] = [];
			if (enabled) style.push(guideLineStyle(columns[index]));
			if (wrap) {
				const indent = countColumn(
					lines[index].match(/^[ \t]*/)?.[0] ?? "",
					state.tabSize,
				);
				style.push(
					`padding-left:calc(${indent}ch + 2px)`,
					`text-indent:-${indent}ch`,
				);
			}
			builder.add(
				from,
				from,
				Decoration.line({
					attributes: {
						...(enabled ? { class: "cm-indent-guides" } : {}),
						style: style.join(";"),
					},
				}),
			);
			from += lines[index].length + 1;
		}
		return builder.finish();
	}

	return StateField.define<DecorationSet>({
		create: build,
		update(decorations, transaction) {
			return transaction.docChanged ||
				transaction.startState.tabSize !== transaction.state.tabSize
				? build(transaction.state)
				: decorations;
		},
		provide: (field) => EditorView.decorations.from(field),
	});
}
