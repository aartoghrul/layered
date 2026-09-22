import { Mark, mergeAttributes, type Editor } from "@tiptap/core";
import { DEPTH_MARK } from "../model/types";

export interface DepthMarkOptions {
  onAddDepth: ((editor: Editor) => void) | null;
}

/** Marks a sentence as having an expansion stored in block `childId`. */
export const DepthMark = Mark.create<DepthMarkOptions>({
  name: DEPTH_MARK,
  inclusive: false,

  addOptions() {
    return { onAddDepth: null };
  },

  addAttributes() {
    return {
      childId: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-depth-id"),
        renderHTML: (attrs) => ({ "data-depth-id": attrs.childId }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-depth-id]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes({ class: "depth-mark" }, HTMLAttributes), 0];
  },

  addKeyboardShortcuts() {
    return {
      "Mod-e": () => {
        this.options.onAddDepth?.(this.editor);
        return true;
      },
    };
  },
});
