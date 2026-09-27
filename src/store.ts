import type { JSONContent } from "@tiptap/core";
import { create } from "zustand";
import { garbageCollect, isDoc, paragraphDoc, pruneEmptyDepths, replaceSentence } from "./model/doc";
import { seedDoc } from "./model/seed";
import type { BlockId, Doc } from "./model/types";

const STORAGE_KEY = "multireader.doc.v2";

function load(): Doc {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (isDoc(parsed)) return pruneEmptyDepths(garbageCollect(parsed));
    }
  } catch {
    // fall through to the sample
  }
  return seedDoc();
}

interface State {
  doc: Doc;
  /** Bumped whenever the whole document is replaced, so editors remount. */
  version: number;
  setBlockContent: (id: BlockId, content: JSONContent) => void;
  ensureBlock: (id: BlockId) => void;
  /** Rewrite the sentence in `parentId` that opens into `childId` (formatted runs). */
  setSentence: (parentId: BlockId, childId: BlockId, runs: JSONContent[]) => void;
  /** Remove depth from sentences whose page is empty. */
  pruneEmpty: () => void;
  replaceDoc: (doc: Doc) => void;
  resetSample: () => void;
}

export const useStore = create<State>((set, get) => ({
  doc: load(),
  version: 0,
  setBlockContent: (id, content) =>
    set((s) => ({ doc: { ...s.doc, blocks: { ...s.doc.blocks, [id]: { id, content } } } })),
  ensureBlock: (id) => {
    if (get().doc.blocks[id]) return;
    get().setBlockContent(id, paragraphDoc(""));
  },
  setSentence: (parentId, childId, runs) => {
    const parent = get().doc.blocks[parentId];
    if (parent) get().setBlockContent(parentId, replaceSentence(parent.content, childId, runs));
  },
  pruneEmpty: () => {
    const doc = pruneEmptyDepths(get().doc);
    if (doc !== get().doc) set({ doc });
  },
  replaceDoc: (doc) => set((s) => ({ doc: pruneEmptyDepths(garbageCollect(doc)), version: s.version + 1 })),
  resetSample: () => set((s) => ({ doc: seedDoc(), version: s.version + 1 })),
}));

let saveTimer: number | undefined;
useStore.subscribe((s) => {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => localStorage.setItem(STORAGE_KEY, JSON.stringify(s.doc)), 300);
});
