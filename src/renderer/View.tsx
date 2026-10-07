import { forwardRef, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { focusNear, HeadlineEditor, PageEditor, type FocusRequest, type ZoomRequest } from "../editor/PageEditor";
import { headlineOf, isEmptyPage, sentenceNodes } from "../model/doc";
import type { BlockId, Doc } from "../model/types";
import { isOverText } from "./hitText";
import { renderInline } from "./renderBlock";

export type LayerRole = "current" | "parent" | "child" | "backdrop";

/** How editing opened: which part of the page takes the caret, and where. */
export interface EditStart extends FocusRequest {
  where: "headline" | "body";
}

export interface EditHandlers {
  onZoom: ZoomRequest;
  start: EditStart | null;
}

interface Props {
  doc: Doc;
  /** Depth ids from the root down to this page; empty = the root page. */
  path: BlockId[];
  role: LayerRole;
  /** Present while this page is being edited in place. */
  editing?: EditHandlers;
  /** Present while this page can be switched to editing. */
  onStartEdit?: (at: EditStart) => void;
}

/** Blank space inside the frame (not letters, not a shaded sentence) opens editing. */
function isBlank(e: React.MouseEvent) {
  const target = e.target as Element;
  if (target.closest(".empty-note")) return true;
  return !target.closest(".dp") && !isOverText(e.clientX, e.clientY);
}

/** One page of the reader: the root, or the inside of a sentence. */
export const View = forwardRef<HTMLDivElement, Props>(function View({ doc, path, role, editing, onStartEdit }, ref) {
  const blockId = path.length ? path[path.length - 1] : doc.rootId;
  const parentId = path.length > 1 ? path[path.length - 2] : doc.rootId;
  const content = doc.blocks[blockId]?.content;
  const parentContent = doc.blocks[parentId]?.content;
  const nodes = content?.content ?? [];
  const headline = path.length ? headlineOf(sentenceNodes(doc, parentId, blockId)).nodes : null;
  const memo = new Map<BlockId, number>();
  const bodyRef = useRef<HTMLDivElement>(null);
  const editors = useRef<{ headline?: Editor; body?: Editor }>({});

  // A quiet "Saved" after each change while editing.
  const [saved, setSaved] = useState(false);
  const firstRun = useRef(true);
  useEffect(() => {
    if (!editing) {
      firstRun.current = true;
      return;
    }
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    setSaved(true);
    const t = setTimeout(() => setSaved(false), 1400);
    return () => clearTimeout(t);
  }, [content, parentContent, editing]);

  const start = editing?.start ?? null;
  /** Which part of the page a point is nearest: the headline above the body, or the body. */
  const nearest = (y: number): EditStart["where"] =>
    headline && y < (bodyRef.current?.getBoundingClientRect().top ?? 0) ? "headline" : "body";

  return (
    <div ref={ref} className={`layer ${role}`} inert={role === "backdrop"} aria-hidden={role === "backdrop" || undefined}>
      <article className="reader">
        <div
          className={`page${editing ? " editing" : ""}`}
          onClick={(e) => {
            if (!onStartEdit || !isBlank(e)) return;
            onStartEdit({ where: nearest(e.clientY), point: { x: e.clientX, y: e.clientY } });
          }}
          onMouseDown={(e) => {
            // While editing, a click on blank space in the frame keeps the caret alive,
            // moving it to the nearest text instead of dropping focus.
            if (!editing || (e.target as Element).closest(".ProseMirror, .bubble")) return;
            const editor = editors.current[nearest(e.clientY)];
            if (!editor) return;
            e.preventDefault();
            focusNear(editor, { x: e.clientX, y: e.clientY });
          }}
        >
          {headline !== null &&
            (editing ? (
              <HeadlineEditor
                parentId={parentId}
                childId={blockId}
                focus={start?.where === "headline" ? start : null}
                onZoom={editing.onZoom}
                onReady={(ed) => (editors.current.headline = ed)}
              />
            ) : (
              <h1 className="headline">{renderInline(headline, doc.blocks, memo)}</h1>
            ))}
          <div className="body" ref={bodyRef}>
            <div className="sheet" />
            {editing ? (
              <PageEditor
                blockId={blockId}
                isRoot={!path.length}
                focus={start?.where === "headline" ? null : (start ?? { edge: "end" })}
                onZoom={editing.onZoom}
                onReady={(ed) => (editors.current.body = ed)}
              />
            ) : isEmptyPage(content) ? (
              <p className="para empty-note">Nothing here yet. Click to write it.</p>
            ) : (
              nodes.map((node, i) => {
                const Tag = node.type === "heading" ? (node.attrs?.level === 2 ? "h2" : "h1") : "p";
                return (
                  <Tag key={i} className="para">
                    {renderInline(node.content, doc.blocks, memo)}
                  </Tag>
                );
              })
            )}
          </div>
          {editing && (
            <span className={`frame-cue${saved ? " saved" : ""}`} aria-hidden>
              Saved
            </span>
          )}
        </div>
      </article>
    </div>
  );
});
