import type { Editor } from "@tiptap/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { collectDepths } from "../model/doc";
import type { BlockId } from "../model/types";
import { useStore } from "../store";
import { BlockEditor } from "./BlockEditor";
import { onCardFocusRequest } from "./focusBus";

/** The whole left pane: the root editor followed by its tree of expansion cards. */
export function DepthTree() {
  const rootId = useStore((s) => s.doc.rootId);
  const ancestors = useMemo(() => [rootId], [rootId]);
  return (
    <div className="editor-tree">
      <BlockEditor blockId={rootId} isRoot />
      <DepthCards blockId={rootId} level={1} ancestors={ancestors} />
    </div>
  );
}

function DepthCards({ blockId, level, ancestors }: { blockId: BlockId; level: number; ancestors: BlockId[] }) {
  const content = useStore((s) => s.doc.blocks[blockId]?.content);
  const depths = useMemo(
    () => collectDepths(content).filter((d) => !ancestors.includes(d.childId)),
    [content, ancestors],
  );
  if (!depths.length) return null;
  return (
    <div className="cards">
      {depths.map((d) => (
        <DepthCard key={d.childId} childId={d.childId} text={d.text} level={level} ancestors={ancestors} />
      ))}
    </div>
  );
}

function DepthCard({ childId, text, level, ancestors }: { childId: BlockId; text: string; level: number; ancestors: BlockId[] }) {
  const exists = useStore((s) => !!s.doc.blocks[childId]);
  const ensureBlock = useStore((s) => s.ensureBlock);
  const [open, setOpen] = useState(true);
  const [flash, setFlash] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const childAncestors = useMemo(() => [...ancestors, childId], [ancestors, childId]);
  const onReady = useCallback((e: Editor) => (editorRef.current = e), []);

  // A mark can outlive its block (e.g. undo after removal); recreate it empty.
  useEffect(() => {
    if (!exists) ensureBlock(childId);
  }, [exists, childId, ensureBlock]);

  useEffect(
    () =>
      onCardFocusRequest(({ childId: id, focusEditor }) => {
        if (id !== childId) return;
        setOpen(true);
        setFlash(true);
        setTimeout(() => setFlash(false), 900);
        requestAnimationFrame(() => {
          ref.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
          if (focusEditor) editorRef.current?.commands.focus("end");
        });
      }),
    [childId],
  );

  return (
    <section ref={ref} className={`card${flash ? " flash" : ""}`} data-level={Math.min(level, 6)}>
      <header onClick={() => setOpen((o) => !o)}>
        <span className={`chev${open ? " open" : ""}`}>›</span>
        <q>{text}</q>
        <span className="lvl">depth {level}</span>
      </header>
      {open && exists && (
        <div className="card-body">
          <BlockEditor blockId={childId} isRoot={false} onReady={onReady} />
          <DepthCards blockId={childId} level={level + 1} ancestors={childAncestors} />
        </div>
      )}
    </section>
  );
}
