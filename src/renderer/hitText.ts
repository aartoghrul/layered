/**
 * Is the point over actual glyphs? Blank space (the gap between paragraphs,
 * the end of a short line, the frame's margin) returns false.
 */
export function isOverText(x: number, y: number): boolean {
  const caret = caretAt(x, y);
  if (!caret || caret.node.nodeType !== Node.TEXT_NODE) return false;
  const text = caret.node as Text;
  const range = document.createRange();
  // The caret sits between two characters; check both neighbours.
  for (const i of [caret.offset - 1, caret.offset]) {
    if (i < 0 || i >= text.length) continue;
    range.setStart(text, i);
    range.setEnd(text, i + 1);
    for (const r of range.getClientRects()) {
      if (x >= r.left - 1 && x <= r.right + 1 && y >= r.top && y <= r.bottom) return true;
    }
  }
  return false;
}

function caretAt(x: number, y: number): { node: Node; offset: number } | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  if (doc.caretPositionFromPoint) {
    const p = doc.caretPositionFromPoint(x, y);
    return p && { node: p.offsetNode, offset: p.offset };
  }
  const r = doc.caretRangeFromPoint?.(x, y);
  return r ? { node: r.startContainer, offset: r.startOffset } : null;
}
