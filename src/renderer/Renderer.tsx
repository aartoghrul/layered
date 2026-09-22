import type { MotionValue } from "motion";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { validPath } from "../model/doc";
import type { BlockId } from "../model/types";
import { useStore } from "../store";
import { usePinchZoom, type Direction } from "./usePinchZoom";
import { View } from "./View";

interface Transition {
  /** The outer page, containing the sentence being zoomed. */
  parent: BlockId[];
  /** The inner page, headed by that sentence. */
  child: BlockId[];
  direction: Direction;
  /** Gesture progress: 0 = where we started, 1 = where we're going. */
  p: MotionValue<number>;
}

const keyOf = (path: BlockId[]) => `/${path.join("/")}`;
const ramp = (z: number, from: number, to: number) => {
  const t = Math.min(1, Math.max(0, (z - from) / (to - from)));
  return t * t * (3 - 2 * t);
};

/** Top-left of the first line box of an element's text. */
function firstLine(el: Element) {
  const range = document.createRange();
  range.selectNodeContents(el);
  return range.getClientRects()[0] ?? el.getBoundingClientRect();
}

export function Renderer() {
  const doc = useStore((s) => s.doc);
  const version = useStore((s) => s.version);
  const [rawPath, setPath] = useState<BlockId[]>([]);
  const path = useMemo(() => validPath(doc, rawPath), [doc, rawPath]);
  const [transition, setTransition] = useState<Transition | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const layers = useRef(new Map<string, HTMLDivElement>());
  const scrolls = useRef(new Map<string, number>());

  // Gesture callbacks can fire before React re-renders, so track the live values in refs.
  const live = useRef({ path, transition });
  live.current.path = path;

  useEffect(() => setPath([]), [version]);

  usePinchZoom(stageRef, {
    begin: (direction, at, p) => {
      const { path, transition } = live.current;
      if (transition) return false;
      let t: Transition;
      if (direction === "in") {
        const id = at?.closest<HTMLElement>(".layer [data-depth-id]")?.dataset.depthId;
        if (!id) return false;
        t = { parent: path, child: [...path, id], direction, p };
      } else {
        if (!path.length) return false;
        t = { parent: path.slice(0, -1), child: path, direction, p };
      }
      live.current.transition = t;
      setTransition(t);
      return true;
    },
    end: (commit) => {
      const t = live.current.transition;
      if (!t) return;
      live.current.transition = null;
      live.current.path = (t.direction === "in") === commit ? t.child : t.parent;
      setPath(live.current.path);
      setTransition(null);
    },
  });

  /*
   * The zoom is a camera move over two stacked pages. The outer page scales
   * up around the sentence while sliding it to where the headline sits; the
   * inner page rides the same camera, starting shrunk onto the sentence and
   * ending at rest. The sentence cross-fades into the headline, the outer
   * page fades away early, and the inner body fades in as it arrives.
   */
  useLayoutEffect(() => {
    if (!transition) return;
    const stage = stageRef.current!.getBoundingClientRect();
    const outer = layers.current.get(keyOf(transition.parent))!;
    const inner = layers.current.get(keyOf(transition.child))!;

    if (transition.direction === "in") scrolls.current.set(keyOf(transition.parent), outer.scrollTop);
    else outer.scrollTop = scrolls.current.get(keyOf(transition.parent)) ?? 0;

    const srcId = transition.child[transition.parent.length];
    const src = outer.querySelector<HTMLElement>(`[data-depth-id="${CSS.escape(srcId)}"]`);
    const head = inner.querySelector<HTMLElement>(".headline")!;
    const h = firstLine(head);
    const Ph = { x: h.left - stage.left, y: h.top - stage.top };
    const s0 = src?.getClientRects()[0];
    const Ps = s0 ? { x: s0.left - stage.left, y: s0.top - stage.top } : { x: Ph.x, y: stage.height / 3 };
    const S = parseFloat(getComputedStyle(head).fontSize) / parseFloat(getComputedStyle(src ?? outer).fontSize);
    src?.setAttribute("data-src", "");
    outer.style.transformOrigin = `${Ps.x}px ${Ps.y}px`;
    inner.style.transformOrigin = `${Ph.x}px ${Ph.y}px`;

    const apply = (p: number) => {
      const z = transition.direction === "in" ? p : 1 - p; // 0 = outer page, 1 = inner page
      const s = 1 + (S - 1) * z;
      outer.style.transform = `translate(${(Ph.x - Ps.x) * z}px, ${(Ph.y - Ps.y) * z}px) scale(${s})`;
      inner.style.transform = `translate(${(Ps.x - Ph.x) * (1 - z)}px, ${(Ps.y - Ph.y) * (1 - z)}px) scale(${s / S})`;
      outer.style.setProperty("--rest", String(1 - ramp(z, 0, 0.4)));
      outer.style.setProperty("--src", String(1 - ramp(z, 0.3, 0.6)));
      inner.style.setProperty("--head", String(ramp(z, 0.3, 0.6)));
      inner.style.setProperty("--body", String(ramp(z, 0.45, 0.95)));
    };
    apply(transition.p.get());
    const unsubscribe = transition.p.on("change", apply);

    return () => {
      unsubscribe();
      src?.removeAttribute("data-src");
      for (const el of [outer, inner]) {
        el.style.transform = el.style.transformOrigin = "";
        for (const v of ["--rest", "--src", "--head", "--body"]) el.style.removeProperty(v);
      }
    };
  }, [transition]);

  const shown: { path: BlockId[]; role: "current" | "parent" | "child" }[] = transition
    ? [
        { path: transition.parent, role: "parent" },
        { path: transition.child, role: "child" },
      ]
    : [{ path, role: "current" }];

  return (
    <div className="stage" ref={stageRef}>
      {shown.map(({ path, role }) => {
        const key = keyOf(path);
        return (
          <View
            key={key}
            ref={(el) => {
              if (el) layers.current.set(key, el);
              else layers.current.delete(key);
            }}
            doc={doc}
            path={path}
            role={role}
          />
        );
      })}
      <div className="reader-hint">
        <span>Pinch to zoom</span>
        <span>Click a sentence to zoom in</span>
        <span>Esc to zoom out</span>
      </div>
    </div>
  );
}
