import type { Editor, JSONContent } from "@tiptap/core";
import { TextSelection, type EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import Document from "@tiptap/extension-document";
import { Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import { nanoid } from "nanoid";
import { useEffect, useMemo, useRef } from "react";
import { headlineOf, sentenceNodes } from "../model/doc";
import { DEPTH_MARK, type BlockId } from "../model/types";
import { MOD } from "../platform";
import { useStore } from "../store";
import { DepthMark } from "./DepthMark";

export interface Point {
  x: number;
  y: number;
}

/** Where the caret goes when an editor opens: near a click, at a paragraph offset, or at an edge. */
export interface FocusRequest {
  point?: Point;
  at?: { index: number; offset: number };
  edge?: "start" | "end";
}

export type ZoomRequest = (direction: "in" | "out", childId?: BlockId) => void;

const kitBase = {
  blockquote: false,
  bulletList: false,
  code: false,
  codeBlock: false,
  hardBreak: false,
  horizontalRule: false,
  link: false,
  listItem: false,
  listKeymap: false,
  orderedList: false,
  strike: false,
  underline: false,
  trailingNode: false,
  dropcursor: false,
  gapcursor: false,
} as const;

/** Trimmed selection range inside one textblock that can take a new depth mark. */
function depthCandidate(state: EditorState): { from: number; to: number } | null {
  let { from, to } = state.selection;
  if (from === to) return null;
  if (!state.doc.resolve(from).sameParent(state.doc.resolve(to))) return null;
  const text = state.doc.textBetween(from, to);
  from += text.length - text.trimStart().length;
  to -= text.length - text.trimEnd().length;
  if (from >= to) return null;
  if (state.doc.rangeHasMark(from, to, state.schema.marks[DEPTH_MARK])) return null;
  return { from, to };
}

/** Give the selected sentence depth (a new, empty page); returns that page's id. */
function addDepth(view: EditorView): BlockId | null {
  const range = depthCandidate(view.state);
  if (!range) return null;
  const id = nanoid(8);
  useStore.getState().ensureBlock(id);
  const { state } = view;
  const tr = state.tr.addMark(range.from, range.to, state.schema.marks[DEPTH_MARK].create({ childId: id }));
  view.dispatch(tr.setSelection(TextSelection.create(tr.doc, range.to)));
  return id;
}

/** Focus the editor at the text nearest a click (or at the end). */
export function focusNear(editor: Editor, p: Point | null) {
  const opts = { scrollIntoView: false };
  if (!p) return editor.commands.focus("end", opts);
  const r = editor.view.dom.getBoundingClientRect();
  if (p.y >= r.bottom) return editor.commands.focus("end", opts);
  if (p.y <= r.top) return editor.commands.focus("start", opts);
  const left = Math.min(r.right - 1, Math.max(r.left + 1, p.x));
  editor.commands.focus(editor.view.posAtCoords({ left, top: p.y })?.pos ?? "end", opts);
}

/** Open an editor with the caret where the request asks. */
function focusFor(editor: Editor, req: FocusRequest) {
  if (req.point) return focusNear(editor, req.point);
  let pos: number | "start" | "end" = req.edge ?? "end";
  const { at } = req;
  if (at) {
    editor.state.doc.forEach((node, offset, index) => {
      if (index === at.index) pos = offset + 1 + Math.min(at.offset, node.content.size);
    });
  }
  editor.commands.focus(pos, { scrollIntoView: false });
}

/** The sentence with depth the caret is in, or right against. */
function depthAtCaret(state: EditorState): BlockId | null {
  const { $from } = state.selection;
  const marks = [...$from.marks(), ...($from.nodeBefore?.marks ?? []), ...($from.nodeAfter?.marks ?? [])];
  return (marks.find((m) => m.type.name === DEPTH_MARK)?.attrs.childId as BlockId | undefined) ?? null;
}

/** ⌘+ / ⌘− (Ctrl elsewhere): add depth / go in, and go out, while writing. */
function zoomKey(e: KeyboardEvent): "in" | "out" | null {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return null;
  if (e.key === "=" || e.key === "+") return "in";
  if (e.key === "-" || e.key === "_") return "out";
  return null;
}

/** Keep a callback fresh inside options the editor captured at creation. */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}

/** Formatting menu over a selection; depth actions only in the page body. */
function Bubble({ editor, onGoDeeper }: { editor: Editor; onGoDeeper?: (childId: BlockId) => void }) {
  const addAndGo = () => {
    const id = addDepth(editor.view);
    if (id) onGoDeeper?.(id);
  };
  const menu = useEditorState({
    editor,
    selector: ({ editor }) => ({
      inDepth: editor.isActive(DEPTH_MARK),
      depthId: (editor.getAttributes(DEPTH_MARK).childId as string | undefined) ?? null,
      canAdd: depthCandidate(editor.state) !== null,
      bold: editor.isActive("bold"),
      italic: editor.isActive("italic"),
    }),
  });
  const keep = (e: React.MouseEvent) => e.preventDefault(); // keep the selection

  return (
    <BubbleMenu
      editor={editor}
      shouldShow={({ editor, state }) => !state.selection.empty || (!!onGoDeeper && editor.isActive(DEPTH_MARK))}
      className="bubble"
    >
      <button className={menu.bold ? "on" : ""} onMouseDown={keep} onClick={() => editor.chain().focus().toggleBold().run()}>
        <b>B</b>
      </button>
      <button className={menu.italic ? "on" : ""} onMouseDown={keep} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <i>I</i>
      </button>
      {onGoDeeper && <span className="sep" />}
      {onGoDeeper &&
        (menu.inDepth ? (
          <>
            <button onMouseDown={keep} onClick={() => menu.depthId && onGoDeeper(menu.depthId)}>
              Go deeper <kbd>{MOD}+</kbd>
            </button>
            <button
              className="danger"
              onMouseDown={keep}
              onClick={() => editor.chain().focus().extendMarkRange(DEPTH_MARK).unsetMark(DEPTH_MARK).run()}
            >
              Remove depth
            </button>
          </>
        ) : (
          <button disabled={!menu.canAdd} onMouseDown={keep} onClick={addAndGo}>
            Add depth <kbd>{MOD}+</kbd>
          </button>
        ))}
    </BubbleMenu>
  );
}

interface PageEditorProps {
  blockId: BlockId;
  isRoot: boolean;
  /** Take focus on mount, with the caret where this asks (null: don't take focus). */
  focus: FocusRequest | null;
  onZoom: ZoomRequest;
  onReady?: (editor: Editor) => void;
}

/** The current page's body, editable in place. Saves on every keystroke. */
export function PageEditor({ blockId, isRoot, focus, onZoom, onReady }: PageEditorProps) {
  const zoom = useLatest(onZoom);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        ...kitBase,
        // Same classes as the reader, so editing doesn't move a single line.
        paragraph: { HTMLAttributes: { class: "para" } },
        heading: isRoot ? { levels: [1, 2], HTMLAttributes: { class: "para" } } : false,
      }),
      Placeholder.configure({ placeholder: isRoot ? "Start writing…" : "Write what this sentence opens into…" }),
      DepthMark,
    ],
    content: useStore.getState().doc.blocks[blockId]?.content,
    onUpdate: ({ editor }) => useStore.getState().setBlockContent(blockId, editor.getJSON()),
    editorProps: {
      attributes: { class: "page-editor" },
      handleKeyDown: (view, e) => {
        const direction = zoomKey(e);
        if (!direction) return false;
        if (direction === "out") zoom.current("out");
        else {
          // A selection gets depth and we go straight in; otherwise go into the sentence at the caret.
          const childId = (view.state.selection.empty ? null : addDepth(view)) ?? depthAtCaret(view.state);
          if (childId) zoom.current("in", childId);
        }
        return true; // never the browser's page zoom while writing
      },
    },
  });

  const start = useRef({ focus, onReady });
  useEffect(() => {
    if (!editor) return;
    start.current.onReady?.(editor);
    if (start.current.focus) focusFor(editor, start.current.focus);
  }, [editor]);

  if (!editor) return null;
  return (
    <>
      <Bubble editor={editor} onGoDeeper={(id) => onZoom("in", id)} />
      <EditorContent editor={editor} />
    </>
  );
}

/** A headline is one line: a single paragraph, no depth. */
const SingleLine = Document.extend({ content: "paragraph" });

interface HeadlineEditorProps {
  parentId: BlockId;
  childId: BlockId;
  focus: FocusRequest | null;
  onZoom: ZoomRequest;
  onReady?: (editor: Editor) => void;
}

/**
 * The headline of an inner page is the sentence it opened from, so editing it
 * rewrites that sentence one layer up, formatting and trailing punctuation
 * included.
 */
export function HeadlineEditor({ parentId, childId, focus, onZoom, onReady }: HeadlineEditorProps) {
  const zoom = useLatest(onZoom);
  const initial = useMemo(() => {
    const { nodes, trailing } = headlineOf(sentenceNodes(useStore.getState().doc, parentId, childId));
    const doc: JSONContent = { type: "doc", content: [{ type: "paragraph", content: nodes }] };
    return { doc, trailing };
  }, [parentId, childId]);

  const editor = useEditor({
    extensions: [StarterKit.configure({ ...kitBase, heading: false, document: false }), SingleLine],
    content: initial.doc,
    onUpdate: ({ editor }) => {
      const runs: JSONContent[] = (editor.getJSON().content?.[0]?.content ?? []).map((r: JSONContent) => ({ ...r }));
      if (!runs.some((r) => r.text?.trim())) return; // never orphan the page
      if (initial.trailing) runs.push(initial.trailing);
      useStore.getState().setSentence(parentId, childId, runs);
    },
    editorProps: {
      attributes: { class: "headline-editor" },
      handleKeyDown: (view, e) => {
        const direction = zoomKey(e);
        if (direction) {
          // A headline has no depth of its own, so only ⌘− does anything here.
          if (direction === "out") zoom.current("out");
          return true;
        }
        if (e.key !== "Enter") return false;
        (view.dom.closest(".page")?.querySelector(".page-editor") as HTMLElement | null)?.focus();
        return true;
      },
    },
  });

  const start = useRef({ focus, onReady });
  useEffect(() => {
    if (!editor) return;
    start.current.onReady?.(editor);
    if (start.current.focus) focusFor(editor, start.current.focus);
  }, [editor]);

  if (!editor) return <h1 className="headline" />;
  return (
    <div className="headline">
      <Bubble editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}
