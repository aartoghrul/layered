import type { JSONContent } from "@tiptap/core";
import type { ReactNode } from "react";
import { depthIdOf, levelsBelow } from "../model/doc";
import type { Doc } from "../model/types";

/** Most levels of depth that still get a darker shade. */
const MAX_WEIGHT = 4;

/**
 * Render a paragraph's inline content. Sentences with depth become zoom
 * targets, shaded by how many levels sit beneath them.
 */
export function renderInline(nodes: JSONContent[] | undefined, blocks: Doc["blocks"], memo: Map<string, number>): ReactNode[] {
  const out: ReactNode[] = [];
  const list = nodes ?? [];
  for (let i = 0; i < list.length; ) {
    const id = depthIdOf(list[i]);
    if (!id || !blocks[id]) {
      out.push(leaf(list[i], String(i)));
      i++;
      continue;
    }
    const start = i;
    while (i < list.length && depthIdOf(list[i]) === id) i++;
    out.push(
      <span key={start} className="dp" data-depth-id={id} data-weight={Math.min(levelsBelow(blocks, id, memo), MAX_WEIGHT)}>
        {list.slice(start, i).map((n, k) => leaf(n, `${start}.${k}`))}
      </span>,
    );
  }
  return out;
}

function leaf(node: JSONContent, key: string): ReactNode {
  let content: ReactNode = node.text ?? "";
  for (const m of node.marks ?? []) {
    if (m.type === "bold") content = <strong>{content}</strong>;
    else if (m.type === "italic") content = <em>{content}</em>;
  }
  return (
    <span key={key} className="leaf">
      {content}
    </span>
  );
}
