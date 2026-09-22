import type { JSONContent } from "@tiptap/core";
import { DEPTH_MARK, type BlockId, type Doc } from "./types";

export function depthIdOf(node: JSONContent): string | null {
  const mark = node.marks?.find((m) => m.type === DEPTH_MARK);
  return (mark?.attrs?.childId as string | undefined) ?? null;
}

export interface DepthRef {
  childId: BlockId;
  text: string;
}

/** All depth marks in a block, in document order, with their full sentence text. */
export function collectDepths(content: JSONContent | undefined): DepthRef[] {
  const out: DepthRef[] = [];
  const walk = (node: JSONContent) => {
    const nodes = node.content ?? [];
    for (let i = 0; i < nodes.length; i++) {
      const id = depthIdOf(nodes[i]);
      if (!id) {
        if (nodes[i].content) walk(nodes[i]);
        continue;
      }
      let text = "";
      while (i < nodes.length && depthIdOf(nodes[i]) === id) {
        text += nodes[i].text ?? "";
        i++;
      }
      i--;
      if (!out.some((d) => d.childId === id)) out.push({ childId: id, text });
    }
  };
  if (content) walk(content);
  return out;
}

export function paragraphDoc(text: string): JSONContent {
  return {
    type: "doc",
    content: [{ type: "paragraph", content: text ? [{ type: "text", text }] : [] }],
  };
}

/** Ids of every block nested under `id` (not including `id`). */
export function descendantIds(doc: Doc, id: BlockId): BlockId[] {
  const out: BlockId[] = [];
  const visit = (bid: BlockId) => {
    for (const { childId } of collectDepths(doc.blocks[bid]?.content)) {
      if (out.includes(childId) || childId === id) continue;
      out.push(childId);
      visit(childId);
    }
  };
  visit(id);
  return out;
}

/** Drop blocks that are no longer reachable from the root. */
export function garbageCollect(doc: Doc): Doc {
  const keep = new Set([doc.rootId, ...descendantIds(doc, doc.rootId)]);
  const blocks: Doc["blocks"] = {};
  for (const id of keep) if (doc.blocks[id]) blocks[id] = doc.blocks[id];
  return { ...doc, blocks };
}

export function isDoc(value: unknown): value is Doc {
  const v = value as Doc;
  return (
    !!v &&
    typeof v.rootId === "string" &&
    typeof v.blocks === "object" &&
    !!v.blocks?.[v.rootId]
  );
}

/** The sentence text of depth mark `childId` inside block `parentId`. */
export function sentenceOf(doc: Doc, parentId: BlockId, childId: BlockId): string | null {
  return collectDepths(doc.blocks[parentId]?.content).find((d) => d.childId === childId)?.text ?? null;
}

/** A sentence reads as a headline without its trailing punctuation. */
export function asHeadline(sentence: string): string {
  return sentence.trim().replace(/[.,;:]+$/, "");
}

/**
 * A zoom path is the chain of depth ids from the root down to the page being
 * read. Cut it at the first step that no longer exists (e.g. the mark was
 * removed in the editor).
 */
export function validPath(doc: Doc, path: BlockId[]): BlockId[] {
  const out: BlockId[] = [];
  let parent = doc.rootId;
  for (const id of path) {
    if (!doc.blocks[id] || sentenceOf(doc, parent, id) === null) break;
    out.push(id);
    parent = id;
  }
  return out.length === path.length ? path : out;
}

/** Title of the root page: its first heading, if any. */
export function rootTitle(doc: Doc): string {
  const h = doc.blocks[doc.rootId]?.content.content?.find((n) => n.type === "heading");
  return h?.content?.map((n) => n.text ?? "").join("") || "Home";
}

/**
 * How many levels of depth sit under sentence `id`: 1 if its page has no
 * sentences with depth of its own, 2 if it does, and so on.
 */
export function levelsBelow(blocks: Doc["blocks"], id: BlockId, memo = new Map<BlockId, number>(), seen: BlockId[] = []): number {
  const cached = memo.get(id);
  if (cached !== undefined) return cached;
  let deepest = 0;
  for (const { childId } of collectDepths(blocks[id]?.content)) {
    if (!blocks[childId] || seen.includes(childId)) continue;
    deepest = Math.max(deepest, levelsBelow(blocks, childId, memo, [...seen, id]));
  }
  memo.set(id, deepest + 1);
  return deepest + 1;
}
