import { useMemo, useState } from "react";
import { layerTree, type LayerNode } from "../model/doc";
import type { BlockId, Doc } from "../model/types";

/** Map width; dashes and positions scale into it. */
const W = 140;
/** Vertical distance between layers. */
const ROW = 18;
/** Gap kept between neighbouring pages on the same layer. */
const GAP = 7;
const MIN_LEN = 6;
/** Dash length for a page: grows with its text, gently (√), capped at the map width. */
const lengthFor = (chars: number) => Math.min(W, MIN_LEN + 3.8 * Math.sqrt(chars));

interface Dash {
  node: LayerNode;
  key: string;
  x: number;
  len: number;
  /** The page's parent dash, for the thread along the current path. */
  parent: Dash | null;
  /** Where its sentence sits on the parent's dash: the thread starts here. */
  anchor: number;
}

/**
 * Lay the tree out as strata, one layer (row) at a time: each page is a dash
 * whose length is its amount of text, starting under the point in its
 * parent's text where its sentence sits. Pages on a row keep a gap between
 * them; a row that would run past the edge shrinks to fit.
 */
function layout(root: LayerNode): Dash[] {
  const keyOf = (n: LayerNode) => n.path.join("/") || "·";
  const out: Dash[] = [];
  let row: Dash[] = [{ node: root, key: keyOf(root), x: 0, len: lengthFor(root.chars), parent: null, anchor: 0 }];
  while (row.length) {
    out.push(...row);
    const next = row
      .flatMap((p) => p.node.children.map((c) => ({ node: c, parent: p, want: p.x + c.at * p.len, len: lengthFor(c.chars) })))
      .sort((a, b) => a.want - b.want);
    if (!next.length) break;
    const pack = (lens: number[]) => {
      const xs: number[] = [];
      next.forEach((n, i) => xs.push(i ? Math.max(n.want, xs[i - 1] + lens[i - 1] + GAP) : n.want));
      return xs;
    };
    let lens = next.map((n) => n.len);
    let xs = pack(lens);
    if (xs[xs.length - 1] + lens[lens.length - 1] > W) {
      const room = W - xs[0] - GAP * (next.length - 1);
      const total = lens.reduce((a, b) => a + b, 0);
      lens = lens.map((l) => Math.max(3, (l * room) / total));
      xs = pack(lens);
    }
    row = next.map((n, i) => ({
      node: n.node,
      key: keyOf(n.node),
      x: Math.min(xs[i], W - 3),
      len: Math.max(3, Math.min(lens[i], W - xs[i])),
      parent: n.parent,
      anchor: Math.min(n.want, n.parent.x + n.parent.len),
    }));
  }
  return out;
}

const isPrefix = (a: BlockId[], b: BlockId[]) => a.length <= b.length && a.every((id, i) => b[i] === id);

interface Props {
  doc: Doc;
  path: BlockId[];
  onJump: (path: BlockId[]) => void;
}

/**
 * A quiet map of the document's layers in the margin. At rest it shows the
 * current layer and its neighbours (n−1, n, n+1); hovered, the whole document. Click a page
 * to go straight there.
 */
export function StrataMap({ doc, path, onJump }: Props) {
  const dashes = useMemo(() => layout(layerTree(doc)), [doc]);
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState<Dash | null>(null);

  const depth = path.length;
  const maxDepth = Math.max(...dashes.map((d) => d.node.depth));
  const from = open ? 0 : Math.max(0, depth - 1);
  const to = open ? maxDepth : Math.min(maxDepth, depth + 1);
  const y = (d: number) => 10 + (d - from) * ROW;
  const height = y(to) + 12;

  /** Is `d` on the chain from the top layer down to `to`? */
  const onChain = (d: Dash, to: BlockId[]) => isPrefix(d.node.path, to);
  const tone = (d: Dash) => {
    if (d.node.path.length === path.length && isPrefix(d.node.path, path)) return "current";
    if (isPrefix(d.node.path, path)) return "path";
    return "other";
  };

  return (
    <nav
      className={`strata${open ? " open" : ""}`}
      aria-label="Layers"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => {
        setOpen(false);
        setHover(null);
      }}
    >
      <svg width={W} height={height} style={{ height }}>
        {/*
          The thread: from where each sentence sits on its parent's dash, down
          (and across, if the page was nudged aside) to the page. Always for the
          current page's chain; for a hovered page's chain too.
        */}
        {dashes
          .filter((d) => d.parent && d.node.depth > from && d.node.depth <= to)
          .map((d) => {
            const current = onChain(d, path);
            const hovered = hover !== null && onChain(d, hover.node.path);
            if (!current && !hovered) return null;
            const top = y(d.node.depth - 1);
            const mid = top + ROW / 2;
            return (
              <path
                key={`t${d.key}`}
                className={`thread${current ? "" : " hovered"}`}
                d={`M ${d.anchor + 0.5} ${top} V ${mid} H ${d.x + 0.5} V ${y(d.node.depth)}`}
              />
            );
          })}
        {dashes.map((d) => {
          const visible = d.node.depth >= from && d.node.depth <= to;
          return (
            <g
              key={d.key}
              className={`dash ${tone(d)}${hover === d ? " hover" : ""}`}
              style={{ transform: `translate(${d.x}px, ${y(Math.min(Math.max(d.node.depth, from), to))}px)`, opacity: visible ? undefined : 0 }}
              onMouseEnter={() => visible && setHover(d)}
              onMouseLeave={() => setHover((h) => (h === d ? null : h))}
              onClick={() => visible && tone(d) !== "current" && onJump(d.node.path)}
            >
              <line className="ink" x1={0} x2={d.len} />
              {visible && <line className="hit" x1={-2} x2={d.len + 2} />}
            </g>
          );
        })}
      </svg>
      <div className="strata-caption">{hover ? hover.node.title : ""}</div>
    </nav>
  );
}
