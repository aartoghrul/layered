import { animate, motionValue, type MotionValue } from "motion";
import { useEffect, useRef, type RefObject } from "react";

export type Direction = "in" | "out";
/** What started a zoom: a trackpad pinch, a click, or code (e.g. a shortcut). */
export type Source = "pinch" | "click" | "code";

interface Handlers {
  /**
   * Start a zoom in `direction`, from the gesture at element `at`. Drive the
   * animation from `p` (0 = where we are, 1 = where we're going); return
   * false if there's nothing to zoom.
   */
  begin: (direction: Direction, at: Element | null, p: MotionValue<number>, source: Source) => boolean;
  /** The zoom settled: `commit` means it ended at the destination. */
  end: (commit: boolean) => void;
}

/** Progress gained per pixel of ctrl-wheel delta (Chrome/Firefox/Edge pinch). */
const WHEEL_GAIN = 0.008;
/** Safari `scale` change needed to fully open / close. */
const SCALE_IN = 0.5;
const SCALE_OUT = 0.35;
/** Wheel pinches have no end event; this much silence counts as release. */
const RELEASE_MS = 160;
/** On release, springs open past this progress, otherwise springs back. */
const THRESHOLD = 0.3;
const SPRING = { type: "spring", stiffness: 320, damping: 34, restDelta: 0.001 } as const;

const clamp = (v: number) => Math.min(1, Math.max(0, v));

interface Active {
  p: MotionValue<number>;
  direction: Direction;
  settling: boolean;
  /** Safari scale at which the gesture picked its target. */
  baseScale: number;
}

interface GestureEvent extends UIEvent {
  scale: number;
}

/**
 * Trackpad pinch → continuous zoom progress, with a spring on release.
 * Spreading the fingers zooms in, pinching them together zooms out. Click and
 * ⌥-click are fallbacks that play the same spring. The returned `play` runs
 * a whole zoom from code.
 */
export function usePinchZoom(ref: RefObject<HTMLElement | null>, handlers: Handlers) {
  const h = useRef(handlers);
  useEffect(() => {
    h.current = handlers;
  });
  const api = useRef({ play: (_direction: Direction, _at: Element | null) => {} });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let g: Active | null = null;
    let locked = false; // after a pinch fully opens, ignore it until the fingers lift
    let inSafariGesture = false;
    let releaseTimer: number | undefined;
    const pointer = { x: 0, y: 0 };

    const begin = (direction: Direction, at: Element | null, source: Source, baseScale = 1) => {
      const p = motionValue(0);
      if (!h.current.begin(direction, at, p, source)) return false;
      g = { p, direction, settling: false, baseScale };
      return true;
    };

    const finish = (commit: boolean) => {
      g = null;
      h.current.end(commit);
    };

    const settle = (force?: 0 | 1) => {
      if (!g || g.settling) return;
      const cur = g;
      cur.settling = true;
      const to = force ?? (cur.p.get() > THRESHOLD ? 1 : 0);
      animate(cur.p, to, SPRING).then(() => finish(to === 1));
    };

    const track = (v: number) => {
      if (!g || g.settling) return;
      g.p.set(clamp(v));
      if (v >= 1) {
        g.settling = true;
        locked = true;
        finish(true);
      }
    };

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return; // plain scrolling
      e.preventDefault(); // no browser page zoom
      if (inSafariGesture) return;
      clearTimeout(releaseTimer);
      releaseTimer = window.setTimeout(() => {
        locked = false;
        settle();
      }, RELEASE_MS);
      if (locked || g?.settling) return;
      if (!g && (e.deltaY === 0 || !begin(e.deltaY < 0 ? "in" : "out", document.elementFromPoint(e.clientX, e.clientY), "pinch"))) return;
      const delta = g!.direction === "in" ? -e.deltaY : e.deltaY;
      track(g!.p.get() + delta * WHEEL_GAIN);
    };

    const onGestureStart = (e: Event) => {
      e.preventDefault();
      inSafariGesture = true;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const s = (e as GestureEvent).scale;
      if (locked || g?.settling) return;
      if (!g && (Math.abs(s - 1) < 0.03 || !begin(s > 1 ? "in" : "out", document.elementFromPoint(pointer.x, pointer.y), "pinch", s))) return;
      const v = g!.direction === "in" ? (s - g!.baseScale) / SCALE_IN : (g!.baseScale - s) / SCALE_OUT;
      track(v);
    };
    const onGestureEnd = (e: Event) => {
      e.preventDefault();
      inSafariGesture = false;
      locked = false;
      settle();
    };

    const onPointerMove = (e: PointerEvent) => {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
    };

    const onClick = (e: MouseEvent) => {
      if (g || window.getSelection()?.toString()) return;
      if (begin(e.altKey ? "out" : "in", document.elementFromPoint(e.clientX, e.clientY), "click")) settle(1);
    };

    api.current.play = (direction, at) => {
      if (!g && begin(direction, at, "code")) settle(1);
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("gesturestart", onGestureStart);
    el.addEventListener("gesturechange", onGestureChange);
    el.addEventListener("gestureend", onGestureEnd);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("click", onClick);
    return () => {
      clearTimeout(releaseTimer);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", onGestureStart);
      el.removeEventListener("gesturechange", onGestureChange);
      el.removeEventListener("gestureend", onGestureEnd);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("click", onClick);
    };
  }, [ref]);

  return api.current;
}
