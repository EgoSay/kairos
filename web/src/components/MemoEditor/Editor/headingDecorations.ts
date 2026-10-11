import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import { viewportDecorations } from "./viewportDecorations";

const lineDecorations = [1, 2, 3, 4, 5, 6].map((level) => Decoration.line({ class: `cm-md-h${level}` }));

function build(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node) => {
        const heading = /^ATXHeading([1-6])$/.exec(node.name);
        if (heading && /^ {0,3}#{1,6}\s/.test(view.state.doc.lineAt(node.from).text))
          builder.add(node.from, node.from, lineDecorations[Number(heading[1]) - 1]);
      },
    });
  }
  return builder.finish();
}

export const headingDecorations = viewportDecorations(build);
