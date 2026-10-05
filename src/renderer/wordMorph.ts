type Point = { x: number; y: number };
/** Where the zoom camera puts a point of an unzoomed page, at the current frame. */
export type Camera = (q: Point) => Point;

interface Piece {
  el: HTMLElement;
  /** Top-left of the text in the sentence and in the headline, unzoomed, in stage coordinates. */
  from: Point;
  to: Point;
  /** Top-left of the text inside the piece's own box. */
  offset: Point;
  /** Punctuation the headline drops: fades out on the way. */
  fades: boolean;
}

/** Each run of non-space text in an element, one per text node it touches. */
function runs(el: Element) {
  const out: Range[] = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    for (const m of n.data.matchAll(/\S+/g)) {
      const r = document.createRange();
      r.setStart(n, m.index);
      r.setEnd(n, m.index + m[0].length);
      out.push(r);
    }
  }
  return out;
}

/**
 * The sentence's words, lifted out of both pages so they can glide from
 * where they sit in the paragraph to where they sit in the headline. The two
 * lines break in different places, so a cross-fade shows words appearing
 * where they weren't; moving each word reflows the sentence continuously.
 * Returns null if the sentence and the headline don't share their words.
 */
export function wordMorph(stage: HTMLElement, after: Element, src: Element, head: Element) {
  const from = runs(src);
  const to = runs(head);
  if (!to.length || from.length < to.length) return null;
  const base = stage.getBoundingClientRect();
  const at = (r: Range): Point => {
    const q = r.getBoundingClientRect();
    return { x: q.left - base.left, y: q.top - base.top };
  };

  const layer = document.createElement("div");
  layer.className = "morph";
  const pieces: Piece[] = [];
  const add = (text: string, style: Element, fromAt: Point, toAt: Point, fades: boolean) => {
    const el = document.createElement("span");
    el.textContent = text;
    const cs = getComputedStyle(style);
    for (const k of ["fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing", "color"] as const) el.style[k] = cs[k];
    layer.append(el);
    pieces.push({ el, from: fromAt, to: toAt, offset: { x: 0, y: 0 }, fades });
  };

  for (let i = 0; i < from.length; i++) {
    const s = from[i].toString();
    if (i >= to.length) {
      // Trailing punctuation in its own run: it leaves from the headline's end.
      const last = to[to.length - 1].getBoundingClientRect();
      add(s, head, at(from[i]), { x: last.right - base.left, y: last.top - base.top }, true);
      continue;
    }
    const h = to[i].toString();
    if (!s.startsWith(h)) return null;
    const style = to[i].startContainer.parentElement ?? head;
    add(h, style, at(from[i]), at(to[i]), false);
    if (s.length > h.length) {
      // "work." becomes "work": the period rides along and fades.
      const rest = document.createRange();
      rest.setStart(from[i].startContainer, from[i].startOffset + h.length);
      rest.setEnd(from[i].endContainer, from[i].endOffset);
      const end = to[i].getBoundingClientRect();
      add(s.slice(h.length), style, at(rest), { x: end.right - base.left, y: end.top - base.top }, true);
    }
  }

  after.after(layer);
  for (const p of pieces) {
    const r = document.createRange();
    r.selectNodeContents(p.el);
    const t = r.getBoundingClientRect();
    const b = p.el.getBoundingClientRect();
    p.offset = { x: t.left - b.left, y: t.top - b.top };
  }

  return {
    /**
     * Place the words for a frame: `m` 0 = laid out as the sentence, 1 = as
     * the headline; `k` = scale relative to the headline's size.
     */
    update(outer: Camera, inner: Camera, m: number, k: number, fade: number) {
      for (const p of pieces) {
        const a = outer(p.from);
        const b = inner(p.to);
        const x = a.x + (b.x - a.x) * m - k * p.offset.x;
        const y = a.y + (b.y - a.y) * m - k * p.offset.y;
        p.el.style.transform = `translate(${x}px, ${y}px) scale(${k})`;
        if (p.fades) p.el.style.opacity = String(1 - fade);
      }
    },
    remove: () => layer.remove(),
  };
}
