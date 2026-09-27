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

/** The formatted runs of the sentence that opens into `childId`, without the depth mark. */
export function sentenceNodes(doc: Doc, parentId: BlockId, childId: BlockId): JSONContent[] {
  const out: JSONContent[] = [];
  const walk = (node: JSONContent) => {
    for (const n of node.content ?? []) {
      if (depthIdOf(n) === childId) out.push({ ...n, marks: n.marks?.filter((m) => m.type !== DEPTH_MARK) });
      else if (n.content) walk(n);
    }
  };
  const parent = doc.blocks[parentId]?.content;
  if (parent) walk(parent);
  return out;
}

/**
 * A sentence as a headline: the same formatted runs, minus trailing
 * punctuation (returned as its own run, formatting kept, so an edit can put
 * it back exactly).
 */
export function headlineOf(nodes: JSONContent[]): { nodes: JSONContent[]; trailing: JSONContent | null } {
  const out = nodes.map((n) => ({ ...n }));
  let trailing: JSONContent | null = null;
  while (out.length) {
    const last = out[out.length - 1];
    const text = (last.text ?? "").replace(/\s+$/, "");
    const m = text.match(/[.,;:]+$/);
    const prev = trailing as JSONContent | null;
    if (m) trailing = { type: "text", text: m[0] + (prev?.text ?? ""), marks: prev?.marks ?? last.marks };
    last.text = m ? text.slice(0, -m[0].length) : text;
    if (last.text) break;
    out.pop();
  }
  return { nodes: out, trailing };
}

/**
 * Replace the sentence that opens into `childId` with new formatted runs,
 * giving each run the depth mark so the sentence keeps its page.
 */
export function replaceSentence(content: JSONContent, childId: BlockId, runs: JSONContent[]): JSONContent {
  const nodes = content.content;
  if (!nodes) return content;
  const out: JSONContent[] = [];
  for (let i = 0; i < nodes.length; i++) {
    if (depthIdOf(nodes[i]) !== childId) {
      out.push(nodes[i].content ? replaceSentence(nodes[i], childId, runs) : nodes[i]);
      continue;
    }
    const depth = nodes[i].marks!.find((m) => m.type === DEPTH_MARK)!;
    for (const r of runs) out.push({ type: "text", text: r.text, marks: [...(r.marks ?? []), depth] });
    while (i + 1 < nodes.length && depthIdOf(nodes[i + 1]) === childId) i++;
  }
  return { ...content, content: out };
}

/** True when a page has no text at all. */
export function isEmptyPage(content: JSONContent | undefined): boolean {
  const text = (n: JSONContent): string => (n.text ?? "") + (n.content ?? []).map(text).join("");
  return !content || !text(content).trim();
}

/** Shade step (1–4) for a sentence: how many levels lie beneath it, capped. */
export function depthWeight(blocks: Doc["blocks"], id: BlockId, memo?: Map<BlockId, number>): number {
  return Math.min(levelsBelow(blocks, id, memo), 4);
}

/**
 * A sentence only has depth if its page has something in it. Strip depth from
 * sentences whose page is empty (and drop those pages).
 */
export function pruneEmptyDepths(doc: Doc): Doc {
  const empty = new Set(Object.keys(doc.blocks).filter((id) => id !== doc.rootId && isEmptyPage(doc.blocks[id].content)));
  if (!empty.size) return doc;
  const strip = (node: JSONContent): JSONContent => {
    if (!node.content) {
      const id = depthIdOf(node);
      if (!id || !empty.has(id)) return node;
      const marks = node.marks!.filter((m) => m.type !== DEPTH_MARK);
      return { ...node, marks: marks.length ? marks : undefined };
    }
    return { ...node, content: node.content.map(strip) };
  };
  const blocks: Doc["blocks"] = {};
  for (const [id, b] of Object.entries(doc.blocks)) blocks[id] = { ...b, content: strip(b.content) };
  return garbageCollect({ ...doc, blocks });
}

/** Paragraph index and character offset just after the sentence that opens into `childId`. */
export function offsetAfterSentence(content: JSONContent | undefined, childId: BlockId): { index: number; offset: number } | null {
  let found: { index: number; offset: number } | null = null;
  (content?.content ?? []).forEach((para, index) => {
    let offset = 0;
    for (const n of para.content ?? []) {
      offset += n.text?.length ?? 0;
      if (depthIdOf(n) === childId) found = { index, offset };
    }
  });
  return found;
}
