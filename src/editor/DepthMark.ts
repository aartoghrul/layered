import { Mark, mergeAttributes } from "@tiptap/core";
import { depthWeight } from "../model/doc";
import { DEPTH_MARK } from "../model/types";
import { useStore } from "../store";

/** Marks a sentence as having an expansion stored in block `childId`. */
export const DepthMark = Mark.create({
  name: DEPTH_MARK,
  // Outermost mark, so one shade wraps a sentence even across bold/italic runs.
  priority: 1000,
  inclusive: false,

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

  // Looks exactly like a shaded sentence in the reader.
  renderHTML({ HTMLAttributes, mark }) {
    const weight = depthWeight(useStore.getState().doc.blocks, mark.attrs.childId);
    return ["span", mergeAttributes({ class: "dp", "data-weight": weight }, HTMLAttributes), 0];
  },
});
