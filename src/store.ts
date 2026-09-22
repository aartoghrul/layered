import type { JSONContent } from "@tiptap/core";
import { create } from "zustand";
import { garbageCollect, isDoc, paragraphDoc } from "./model/doc";
import { seedDoc } from "./model/seed";
import type { BlockId, Doc } from "./model/types";

const STORAGE_KEY = "multireader.doc.v2";

function load(): Doc {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (isDoc(parsed)) return garbageCollect(parsed);
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
  replaceDoc: (doc) => set((s) => ({ doc: garbageCollect(doc), version: s.version + 1 })),
  resetSample: () => set((s) => ({ doc: seedDoc(), version: s.version + 1 })),
}));

let saveTimer: number | undefined;
useStore.subscribe((s) => {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => localStorage.setItem(STORAGE_KEY, JSON.stringify(s.doc)), 300);
});
