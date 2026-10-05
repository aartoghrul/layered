import { motionValue, type MotionValue } from "motion";
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
/**
 * A pinch past this progress finishes on its own, carrying on from the
 * fingers' speed; released short of it, it springs back. Finishing only on
 * release would stall: Chrome sends no release, so the page would sit
 * mid-zoom until RELEASE_MS of silence, then lurch on from rest.
 */
const THRESHOLD = 0.3;

/*
 * The text has weight. Every zoom moves a target along a path, and progress
 * follows the target like a mass on a critically damped spring: it never
 * starts or stops abruptly, and speed carries through every hand-off. While
 * the fingers are down the target is the fingers; to finish, the target
 * glides from where it is to the end, starting at the speed it was moving and
 * easing to rest.
 */
/** How closely the text follows its target; it trails by about 2 / RATE s. */
const RATE = 18;
/** A zoom from a click or a key: unhurried, so the page reads as moving. */
export const ZOOM_MS = 820;
/** Finishing a pinch: quick when the fingers were fast, never abrupt. */
const FINISH_MIN_MS = 380;
const FINISH_MAX_MS = 820;
const SPRING_BACK_MS = 520;

const clamp = (v: number) => Math.min(1, Math.max(0, v));

/** The target's path to an end: a cubic from where it is, at the speed it had, to rest. */
interface Glide {
  from: number;
  to: number;
  /** Starting speed, in progress per second. */
  speed: number;
  /** In seconds. */
  duration: number;
  /** When the glide set off (performance.now()), once motion has started. */
  start: number | null;
}

function glideAt(gl: Glide, now: number) {
  const s = Math.min(1, (now - gl.start!) / 1000 / gl.duration);
  const h10 = s * s * s - 2 * s * s + s;
  const h01 = -2 * s * s * s + 3 * s * s;
  return gl.from + gl.speed * gl.duration * h10 + (gl.to - gl.from) * h01;
}

interface Active {
  p: MotionValue<number>;
  direction: Direction;
  /** Where progress is headed: the fingers, or once settling, along the glide. */
  target: number;
  /** Set once settling: the end the zoom is heading to, and the path there. */
  to: 0 | 1 | null;
  glide: Glide | null;
  /** In progress per second. */
  velocity: number;
  /** The zoom's first frame has painted, so motion can start. */
  ready: boolean;
  /** The motion loop's pending frame, if it's running. */
  frame: number;
  /** Safari scale at which the gesture picked its target. */
  baseScale: number;
}

interface GestureEvent extends UIEvent {
  scale: number;
}

/**
 * Trackpad pinch → continuous zoom progress, finishing on its own.
 * Spreading the fingers zooms in, pinching them together zooms out. Click and
 * ⌥-click are fallbacks that play a whole zoom. The returned `play` runs a
 * whole zoom from code, optionally over `ms`.
 */
export function usePinchZoom(ref: RefObject<HTMLElement | null>, handlers: Handlers) {
  const h = useRef(handlers);
  useEffect(() => {
    h.current = handlers;
  });
  const api = useRef({ play: (_direction: Direction, _at: Element | null, _ms?: number) => {} });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let g: Active | null = null;
    let locked = false; // after a pinch commits, ignore it until the fingers lift
    let inSafariGesture = false;
    let releaseTimer: number | undefined;
    const pointer = { x: 0, y: 0 };

    const begin = (direction: Direction, at: Element | null, source: Source, baseScale = 1) => {
      const p = motionValue(0);
      if (!h.current.begin(direction, at, p, source)) return false;
      const cur: Active = { p, direction, target: 0, to: null, glide: null, velocity: 0, ready: false, frame: 0, baseScale };
      g = cur;
      // Mounting the next page makes the next frame heavy. Start moving on the
      // frame after it, or the first step of motion lands late and jumps.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          cur.ready = true;
          if (g === cur) move(cur);
        }),
      );
      return true;
    };

    const finish = (commit: boolean) => {
      g = null;
      h.current.end(commit);
    };

    /** Make sure the motion loop is running. */
    const move = (cur: Active) => {
      if (!cur.ready || cur.frame) return;
      const now = performance.now();
      if (cur.glide && cur.glide.start === null) cur.glide.start = now;
      step(cur, now);
    };

    /** One frame: advance the target, then the text after it (solved exactly, so uneven frames stay smooth). */
    const step = (cur: Active, last: number) => {
      cur.frame = requestAnimationFrame((now) => {
        cur.frame = 0;
        if (g !== cur) return;
        const gl = cur.glide;
        if (gl) {
          cur.target = glideAt(gl, now);
          if (now - gl.start! >= gl.duration * 1000) cur.glide = null;
        }
        const t = Math.min(now - last, 50) / 1000;
        const e0 = cur.p.get() - cur.target;
        const k = cur.velocity + RATE * e0;
        const decay = Math.exp(-RATE * t);
        const e = (e0 + k * t) * decay;
        cur.velocity = (cur.velocity - RATE * k * t) * decay;
        if (!cur.glide && Math.abs(e) < 2e-4 && Math.abs(cur.velocity) < 2e-3) {
          cur.velocity = 0;
          cur.p.set(cur.target);
          if (cur.to !== null) finish(cur.to === 1);
          return; // otherwise at rest until the fingers move again
        }
        cur.p.set(cur.target + e);
        step(cur, now);
      });
    };

    const settling = () => g !== null && g.to !== null;

    /**
     * Head for an end: `force`, or whichever side of the threshold the fingers
     * are on. The target sets off at the speed the text had, so a pinch's
     * momentum carries straight into the finish.
     */
    const settle = (force?: 0 | 1, ms?: number) => {
      if (!g || g.to !== null) return;
      const to = force ?? (g.target > THRESHOLD ? 1 : 0);
      const from = g.target;
      const speed = g.velocity;
      const toward = speed * Math.sign(to - from);
      let duration = (ms ?? ZOOM_MS) / 1000;
      if (ms === undefined && speed !== 0) {
        // Carried on from a pinch: about the time its speed would take, easing out.
        duration = toward > 0 ? (2.2 * Math.abs(to - from)) / toward : SPRING_BACK_MS / 1000;
        duration = Math.min(FINISH_MAX_MS, Math.max(FINISH_MIN_MS, duration * 1000)) / 1000;
      }
      g.to = to;
      g.glide = { from, to, speed, duration, start: g.frame ? performance.now() : null };
      move(g);
    };

    const track = (v: number) => {
      if (!g || g.to !== null) return;
      g.target = clamp(v);
      if (g.target > THRESHOLD) {
        locked = true;
        settle(1);
      } else move(g);
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
      if (locked || settling()) return;
      if (!g && (e.deltaY === 0 || !begin(e.deltaY < 0 ? "in" : "out", document.elementFromPoint(e.clientX, e.clientY), "pinch"))) return;
      const delta = g!.direction === "in" ? -e.deltaY : e.deltaY;
      track(g!.target + delta * WHEEL_GAIN);
    };

    const onGestureStart = (e: Event) => {
      e.preventDefault();
      inSafariGesture = true;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const s = (e as GestureEvent).scale;
      if (locked || settling()) return;
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
      if (begin(e.altKey ? "out" : "in", document.elementFromPoint(e.clientX, e.clientY), "click")) settle(1, ZOOM_MS);
    };

    api.current.play = (direction, at, ms) => {
      if (!g && begin(direction, at, "code")) settle(1, ms ?? ZOOM_MS);
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
