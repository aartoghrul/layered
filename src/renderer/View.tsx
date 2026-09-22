import { forwardRef } from "react";
import { asHeadline, sentenceOf } from "../model/doc";
import type { BlockId, Doc } from "../model/types";
import { renderInline } from "./renderBlock";

export type LayerRole = "current" | "parent" | "child";

interface Props {
  doc: Doc;
  /** Depth ids from the root down to this page; empty = the root page. */
  path: BlockId[];
  role: LayerRole;
}

/** One page of the reader: the root, or the inside of a sentence. */
export const View = forwardRef<HTMLDivElement, Props>(function View({ doc, path, role }, ref) {
  const blockId = path.length ? path[path.length - 1] : doc.rootId;
  const nodes = doc.blocks[blockId]?.content.content ?? [];
  const parentOf = (i: number) => (i === 0 ? doc.rootId : path[i - 1]);
  const headline = path.length ? asHeadline(sentenceOf(doc, parentOf(path.length - 1), blockId) ?? "") : null;
  const memo = new Map<BlockId, number>();

  return (
    <div ref={ref} className={`layer ${role}`}>
      <article className="reader">
        {headline !== null && <h1 className="headline">{headline}</h1>}
        <div className="body">
          {nodes.map((node, i) => {
            const Tag = node.type === "heading" ? (node.attrs?.level === 2 ? "h2" : "h1") : "p";
            return (
              <Tag key={i} className="para">
                {renderInline(node.content, doc.blocks, memo)}
              </Tag>
            );
          })}
        </div>
      </article>
    </div>
  );
});
