import type { MotionValue } from "motion";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { offsetAfterSentence, validPath } from "../model/doc";
import type { BlockId } from "../model/types";
import { MOD } from "../platform";
import { useStore } from "../store";
import { usePinchZoom, type Direction } from "./usePinchZoom";
import { View, type EditHandlers, type EditStart } from "./View";

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

  const [editing, setEditing] = useState(false);
  /** How editing opened, so the caret goes to the right place. */
  const [editStart, setEditStart] = useState<EditStart | null>(null);

  // Gesture callbacks can fire before React re-renders, so track the live values in refs.
  // `resumeEditing`: a zoom began while writing, so writing resumes where it lands.
  const live = useRef({ path, transition, editing, resumeEditing: false });
  live.current.path = path;
  live.current.editing = editing;

  useEffect(() => {
    setPath([]);
    setEditing(false);
  }, [version]);

  const zoom = usePinchZoom(stageRef, {
    begin: (direction, at, p, source) => {
      const { path, transition, editing } = live.current;
      // While writing, a click places the caret rather than zooming.
      if (transition || (editing && source === "click")) return false;
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
      // The zoom animates the reading form of the page; writing resumes on landing.
      if (editing) {
        live.current.resumeEditing = true;
        setEditing(false);
      }
      return true;
    },
    end: (commit) => {
      const t = live.current.transition;
      if (!t) return;
      live.current.transition = null;
      const landedOuter = (t.direction === "in") !== commit;
      const store = useStore.getState();
      // Where the sentence we came from ends on the outer page, for the caret.
      const outerId = t.parent.at(-1) ?? store.doc.rootId;
      const after = offsetAfterSentence(store.doc.blocks[outerId]?.content, t.child[t.parent.length]);
      // A page left empty doesn't count: its sentence goes back to plain text.
      if (landedOuter) store.pruneEmpty();
      live.current.path = landedOuter ? t.parent : t.child;
      setPath(live.current.path);
      setTransition(null);
      if (live.current.resumeEditing) {
        live.current.resumeEditing = false;
        // Back on the outer page, the caret waits right after the sentence we came from.
        setEditStart(landedOuter && after ? { where: "body", at: after } : { where: "body", edge: "start" });
        setEditing(true);
      }
    },
  });

  const startEditing = useCallback((at: EditStart) => {
    if (live.current.transition) return;
    setEditStart(at);
    setEditing(true);
  }, []);
  // ⌘+ / ⌘− and "Go deeper" while writing.
  const zoomFromEditor = useCallback(
    (direction: "in" | "out", childId?: BlockId) => {
      const layer = layers.current.get(keyOf(live.current.path));
      const at = childId ? (layer?.querySelector(`[data-depth-id="${CSS.escape(childId)}"]`) ?? null) : null;
      zoom.play(direction, at);
    },
    [zoom],
  );
  const editHandlers: EditHandlers = useMemo(() => ({ onZoom: zoomFromEditor, start: editStart }), [zoomFromEditor, editStart]);

  // Finish editing on a click outside the page.
  useEffect(() => {
    if (!editing) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!(e.target as Element).closest(".page.editing, .bubble")) setEditing(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [editing]);

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
            editing={role === "current" && editing ? editHandlers : undefined}
            onStartEdit={role === "current" && !editing ? startEditing : undefined}
          />
        );
      })}
      <div className="reader-hint">
        {editing ? (
          <>
            <span>Select text and press {MOD}+ to give it depth</span>
            <span>{MOD}+ / {MOD}− to move between layers</span>
            <span>Click outside when done</span>
          </>
        ) : (
          <>
            <span>Pinch to zoom</span>
            <span>Click a sentence to zoom in</span>
            <span>⌥-click to zoom out</span>
            <span>Click any blank space to edit</span>
          </>
        )}
      </div>
    </div>
  );
}
