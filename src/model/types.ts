import type { JSONContent } from "@tiptap/core";

export type BlockId = string;

/**
 * A block is one TipTap document. The root block holds the top-level
 * paragraphs; every other block holds a single paragraph that replaces the
 * sentence carrying a `depth` mark pointing at it.
 */
export interface Block {
  id: BlockId;
  content: JSONContent;
}

export interface Doc {
  rootId: BlockId;
  blocks: Record<BlockId, Block>;
}

export const DEPTH_MARK = "depth";
