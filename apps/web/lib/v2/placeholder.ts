import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

const placeholderPluginKey = new PluginKey("v2Placeholder");

/** Marks the only block of an empty manuscript with `data-placeholder`, which the stylesheet renders. */
export function createPlaceholderPlugin(text: string): Plugin {
  return new Plugin({
    key: placeholderPluginKey,
    props: {
      decorations(state) {
        const { doc } = state;
        const first = doc.firstChild;

        if (doc.childCount !== 1 || !first || !first.isTextblock || first.content.size > 0) {
          return null;
        }

        return DecorationSet.create(doc, [Decoration.node(0, first.nodeSize, { "data-placeholder": text })]);
      }
    }
  });
}
