import type { JSONContent } from "@tiptap/core";
import { DEPTH_MARK, type Doc } from "./types";

const t = (text: string): JSONContent => ({ type: "text", text });
const d = (text: string, childId: string): JSONContent => ({
  type: "text",
  text,
  marks: [{ type: DEPTH_MARK, attrs: { childId } }],
});
const p = (...content: JSONContent[]): JSONContent => ({ type: "paragraph", content });
const page = (...paragraphs: JSONContent[]): JSONContent => ({ type: "doc", content: paragraphs });

export function seedDoc(): Doc {
  const blocks: Doc["blocks"] = {};
  const add = (id: string, content: JSONContent) => (blocks[id] = { id, content });

  add(
    "root",
    page(
      { type: "heading", attrs: { level: 1 }, content: [t("Text with depth")] },
      p(
        t("Most writing on the internet is flat. "),
        d("It is a relic of paper.", "paper"),
        t(" But a screen is not a page, and "),
        d("digital text can have depth.", "depth"),
        t(" Any shaded sentence can be opened to read it in more detail; the darker the shade, the deeper it goes."),
      ),
      p(
        d("Readers skim at different resolutions.", "resolutions"),
        t(" Some want the headline, some want the argument, and some want every footnote. "),
        d("One text can serve all of them.", "serve"),
      ),
      p(
        t("Try it: hover over a shaded sentence and spread two fingers on your trackpad. "),
        t("Pinch them together to zoom back out. Without a trackpad, click a sentence to zoom in and press Esc to zoom out."),
      ),
    ),
  );

  add(
    "paper",
    page(
      p(t("Printed pages are fixed and expensive to change. A writer had to settle on a single level of detail and commit to it for every reader.")),
      p(
        t("That level was "),
        d("usually a compromise.", "compromise"),
        t(" Anything more would not fit, and anything less would not be worth printing."),
      ),
    ),
  );
  add(
    "compromise",
    page(
      p(t("Too dense for the newcomer, too shallow for the expert, and a little too long for everyone in between.")),
      p(t("Footnotes, appendices and sidebars were paper's attempt at depth: detail pushed to the edges of the page, where most readers never went.")),
    ),
  );
  add(
    "depth",
    page(
      p(t("A sentence on a screen can be a summary that opens. Zoom into it and the longer thought behind it fills the page: the example, the caveat, the evidence.")),
      p(t("And "), d("the longer thought can open again,", "longer"), t(" as deep as the writer cares to go.")),
    ),
  );
  add(
    "longer",
    page(
      p(t("You are now two levels down. Nothing here is shaded, so this is as deep as this thought goes.")),
      p(t("Pinch your fingers together to climb back up, one level at a time.")),
    ),
  );
  add(
    "resolutions",
    page(
      p(t("Readers arrive with different amounts of time and curiosity. The same article is a two-minute skim for one person and an hour of study for another.")),
    ),
  );
  add(
    "serve",
    page(
      p(t("With depth, the skimmer stays on the surface and the curious reader zooms in only where they care to.")),
      p(t("Nobody has to wade through detail they did not ask for, and nobody is left wanting more.")),
    ),
  );

  return { rootId: "root", blocks };
}
