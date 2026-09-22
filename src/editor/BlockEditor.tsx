import type { Editor } from "@tiptap/core";
import { Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import { nanoid } from "nanoid";
import { useEffect } from "react";
import { DEPTH_MARK, type BlockId } from "../model/types";
import { useStore } from "../store";
import { DepthMark } from "./DepthMark";
import { requestCardFocus } from "./focusBus";

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
function depthCandidate(editor: Editor): { from: number; to: number } | null {
  const { state } = editor;
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

function addDepth(editor: Editor) {
  const range = depthCandidate(editor);
  if (!range) return;
  const id = nanoid(8);
  useStore.getState().ensureBlock(id);
  editor
    .chain()
    .focus()
    .setTextSelection(range)
    .setMark(DEPTH_MARK, { childId: id })
    .setTextSelection(range.to)
    .run();
  requestCardFocus(id, true);
}

interface Props {
  blockId: BlockId;
  isRoot: boolean;
  onReady?: (editor: Editor) => void;
}

export function BlockEditor({ blockId, isRoot, onReady }: Props) {
  const editor = useEditor({
    extensions: isRoot
      ? [StarterKit.configure({ ...kitBase, heading: { levels: [1, 2] } }), DepthMark.configure({ onAddDepth: addDepth })]
      : [
          StarterKit.configure({ ...kitBase, heading: false }),
          Placeholder.configure({ placeholder: "Write what this sentence zooms into…" }),
          DepthMark.configure({ onAddDepth: addDepth }),
        ],
    content: useStore.getState().doc.blocks[blockId]?.content,
    onUpdate: ({ editor }) => useStore.getState().setBlockContent(blockId, editor.getJSON()),
    editorProps: { attributes: { class: isRoot ? "pm root" : "pm child" } },
  });

  useEffect(() => {
    if (editor) onReady?.(editor);
  }, [editor, onReady]);

  const menu = useEditorState({
    editor,
    selector: ({ editor }) => ({
      inDepth: editor?.isActive(DEPTH_MARK) ?? false,
      depthId: (editor?.getAttributes(DEPTH_MARK).childId as string | undefined) ?? null,
      canAdd: editor ? depthCandidate(editor) !== null : false,
      bold: editor?.isActive("bold") ?? false,
      italic: editor?.isActive("italic") ?? false,
    }),
  });

  if (!editor) return null;

  return (
    <>
      <BubbleMenu
        editor={editor}
        shouldShow={({ editor, state }) => !state.selection.empty || editor.isActive(DEPTH_MARK)}
        className="bubble"
      >
        <button
          className={menu?.bold ? "on" : ""}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <b>B</b>
        </button>
        <button
          className={menu?.italic ? "on" : ""}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <i>I</i>
        </button>
        <span className="sep" />
        {menu?.inDepth ? (
          <>
            <button onMouseDown={(e) => e.preventDefault()} onClick={() => menu.depthId && requestCardFocus(menu.depthId, true)}>
              Edit its page ↓
            </button>
            <button
              className="danger"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => editor.chain().focus().extendMarkRange(DEPTH_MARK).unsetMark(DEPTH_MARK).run()}
            >
              Remove depth
            </button>
          </>
        ) : (
          <button disabled={!menu?.canAdd} onMouseDown={(e) => e.preventDefault()} onClick={() => addDepth(editor)}>
            Add depth <kbd>⌘E</kbd>
          </button>
        )}
      </BubbleMenu>
      <EditorContent editor={editor} />
    </>
  );
}
