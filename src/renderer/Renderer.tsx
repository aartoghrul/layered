import type { MotionValue } from "motion";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { offsetAfterSentence, validPath } from "../model/doc";
import type { BlockId } from "../model/types";
import { MOD } from "../platform";
import { useStore } from "../store";
import { StrataMap } from "./StrataMap";
import { usePinchZoom, type Direction } from "./usePinchZoom";
import { View, type EditHandlers, type EditStart } from "./View";
import { wordMorph } from "./wordMorph";

interface Transition {
  /** The outer page, containing the sentence being zoomed. */
  parent: BlockId[];
  /** The inner page, headed by that sentence. */
  child: BlockId[];
  direction: Direction;
  /** Gesture progress: 0 = where we started, 1 = where we're going. */
  p: MotionValue<number>;
}

/** A jump through the strata map goes one level at a time, this long each... */
const STEP_MS = 720;
/** ...pausing on each page it passes, long enough to see where you are. */
const DWELL_MS = 180;

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
  // `jump`: the next zoom queued by the strata map; `route`: the pages after it, in order.
  const live = useRef({
    path,
    transition,
    editing,
    resumeEditing: false,
    jump: null as Omit<Transition, "p"> | null,
    route: [] as BlockId[][],
  });
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
      const jump = source === "code" ? live.current.jump : null;
      live.current.jump = null;
      if (source !== "code") live.current.route = []; // the reader took over
      if (jump) {
        t = { ...jump, p };
      } else if (direction === "in") {
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
      if (commit && live.current.route.length) setTimeout(stepRoute, DWELL_MS);
      else live.current.route = [];
    },
  });

  /**
   * Go to any page, a level at a time: up to the page both share, then down,
   * so every page between is seen on the way.
   */
  const jumpTo = (target: BlockId[]) => {
    const cur = live.current.path;
    if (live.current.transition) return;
    let common = 0;
    while (common < cur.length && common < target.length && cur[common] === target[common]) common++;
    const route: BlockId[][] = [];
    for (let n = cur.length - 1; n >= common; n--) route.push(cur.slice(0, n));
    for (let n = common + 1; n <= target.length; n++) route.push(target.slice(0, n));
    live.current.route = route;
    stepRoute();
  };

  /** Zoom one level along the route. */
  const stepRoute = () => {
    const next = live.current.route.shift();
    if (!next || live.current.transition) return void (live.current.route = []);
    const cur = live.current.path;
    const direction = next.length > cur.length ? "in" : "out";
    live.current.jump = direction === "in" ? { parent: cur, child: next, direction } : { parent: next, child: cur, direction };
    zoom.play(direction, null, STEP_MS);
  };

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
      if (!(e.target as Element).closest(".page.editing, .bubble, .strata")) setEditing(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [editing]);

  /*
   * The zoom is a camera move over two stacked pages. The outer page scales
   * up around the sentence while sliding it to where the headline sits; the
   * inner page rides the same camera, starting shrunk onto the sentence and
   * ending at rest. The sentence's words glide from their places in the
   * paragraph into the headline, the outer page fades away early, and the
   * inner body fades in as it arrives.
   *
   * Every frame touches only transforms and the opacity of a few composited
   * elements, so the browser never repaints the pages' text mid-zoom.
   */
  useLayoutEffect(() => {
    if (!transition) return;
    const stageEl = stageRef.current!;
    const stage = stageEl.getBoundingClientRect();
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
    const outerPage = outer.querySelector<HTMLElement>(".page")!;
    const innerBody = inner.querySelector<HTMLElement>(".body")!;
    const S = parseFloat(getComputedStyle(head).fontSize) / parseFloat(getComputedStyle(src ?? outer).fontSize);
    outer.style.transformOrigin = `${Ps.x}px ${Ps.y}px`;
    inner.style.transformOrigin = `${Ph.x}px ${Ph.y}px`;

    // The words travel on their own layer; the sentence keeps only its shading.
    const morph = src ? wordMorph(stageEl, inner, src, head) : null;
    if (morph) src!.setAttribute("data-src", "");

    const apply = (p: number) => {
      const z = transition.direction === "in" ? p : 1 - p; // 0 = outer page, 1 = inner page
      const s = 1 + (S - 1) * z;
      const to = { x: (Ph.x - Ps.x) * z, y: (Ph.y - Ps.y) * z }; // outer page's travel
      const ti = { x: (Ps.x - Ph.x) * (1 - z), y: (Ps.y - Ph.y) * (1 - z) }; // inner page's
      outer.style.transform = `translate3d(${to.x}px, ${to.y}px, 0) scale(${s})`;
      inner.style.transform = `translate3d(${ti.x}px, ${ti.y}px, 0) scale(${s / S})`;
      outerPage.style.opacity = String(1 - ramp(z, 0.08, 0.45)); // solid as it sets off, then gone
      innerBody.style.opacity = String(ramp(z, 0.45, 0.95));
      if (morph) {
        head.style.opacity = "0";
        morph.update(
          (q) => ({ x: Ps.x + to.x + s * (q.x - Ps.x), y: Ps.y + to.y + s * (q.y - Ps.y) }),
          (q) => ({ x: Ph.x + ti.x + (s / S) * (q.x - Ph.x), y: Ph.y + ti.y + (s / S) * (q.y - Ph.y) }),
          ramp(z, 0.1, 0.8),
          s / S,
          ramp(z, 0.1, 0.5),
        );
      } else head.style.opacity = String(ramp(z, 0.3, 0.6));
    };
    apply(transition.p.get());
    const unsubscribe = transition.p.on("change", apply);

    return () => {
      unsubscribe();
      morph?.remove();
      src?.removeAttribute("data-src");
      for (const el of [outer, inner]) el.style.transform = el.style.transformOrigin = "";
      for (const el of [outerPage, head, innerBody]) el.style.opacity = "";
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
      <StrataMap doc={doc} path={path} onJump={jumpTo} />
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
