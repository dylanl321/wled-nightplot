"use client";

import type Konva from "konva";
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { Layer, Line, Stage } from "react-konva";
import {
  BACKGROUND_NAME,
  DEFAULT_LIMITS,
  fitCamera,
  gridLines,
  isTap,
  panBy,
  pinchStep,
  wheelFactor,
  zoomAt,
  zoomStep,
  type Bounds,
  type Camera,
  type Point,
  type Size,
  type ZoomLimits,
} from "./camera";

export type StageTap = { world: Point; screen: Point; altKey: boolean; shiftKey: boolean };

export type EditorStageHandle = {
  fit: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  camera: () => Camera;
  /** Screen px (relative to the stage) to world metres, through the inverted stage transform. */
  toWorld: (screen: Point) => Point;
};

export type EditorStageProps = {
  /** The world box Fit frames, in metres. */
  bounds: Bounds;
  limits?: ZoomLimits;
  /** Grid step in metres. Leave out for no grid. */
  gridM?: number;
  /** Accessible name of the drawing. */
  label: string;
  testId?: string;
  /** Show Zoom in, Zoom out, and Fit. On by default. */
  controls?: boolean;
  className?: string;
  ref?: Ref<EditorStageHandle>;
  /** A press on empty space (or a background shape) that did not move. */
  onBackgroundTap?: (tap: StageTap) => void;
  onCameraChange?: (camera: Camera) => void;
  /**
   * World content. Place a world point at `(x, -y)`. Use `camera.ppm` to keep
   * handles and labels a constant screen size, and `strokeScaleEnabled={false}`
   * on lines.
   */
  children?: (camera: Camera) => ReactNode;
};

type Press =
  | { kind: "idle" }
  /** One pointer on empty space: a tap until it moves past the slop, then a pan. */
  | { kind: "background"; pointerId: number; start: Point; last: Point; panning: boolean; tappable: boolean }
  | { kind: "pinch" }
  /** A press a shape owns (a corner, a run, a prop). The stage does nothing with it. */
  | { kind: "shape"; pointerId: number };

/**
 * One Konva stage for both the path editor and the yard: wheel and trackpad
 * zoom toward the pointer, background / space / middle-button pan, two-finger
 * pinch, and Zoom in, Zoom out, Fit. The camera lives here; the drawing is the
 * caller’s.
 */
export function EditorStage({
  bounds,
  limits = DEFAULT_LIMITS,
  gridM,
  label,
  testId = "editor-stage",
  controls = true,
  className,
  ref,
  onBackgroundTap,
  onCameraChange,
  children,
}: EditorStageProps) {
  const frame = useRef<HTMLDivElement>(null);
  const stage = useRef<Konva.Stage>(null);
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  const [camera, setCamera] = useState<Camera>({ ppm: 50, ox: 0, oy: 0 });
  const [grabbing, setGrabbing] = useState(false);
  const cameraRef = useRef(camera);
  const sizeRef = useRef(size);
  const boundsRef = useRef(bounds);
  const limitsRef = useRef(limits);
  const pointers = useRef(new Map<number, Point>());
  const press = useRef<Press>({ kind: "idle" });
  const space = useRef(false);
  const fitted = useRef(false);
  const tapRef = useRef(onBackgroundTap);
  const changeRef = useRef(onCameraChange);
  // Pointer and wheel handlers read the latest props without re-binding.
  useLayoutEffect(() => {
    boundsRef.current = bounds;
    limitsRef.current = limits;
    tapRef.current = onBackgroundTap;
    changeRef.current = onCameraChange;
  });

  const moveCamera = useCallback((next: Camera | ((current: Camera) => Camera)) => {
    const value = typeof next === "function" ? next(cameraRef.current) : next;
    cameraRef.current = value;
    setCamera(value);
    changeRef.current?.(value);
  }, []);

  const fit = useCallback(() => {
    const current = sizeRef.current;
    if (current.w <= 0 || current.h <= 0) return;
    moveCamera(fitCamera(boundsRef.current, current, limitsRef.current));
  }, [moveCamera]);

  const zoomIn = useCallback(() => moveCamera((current) => zoomStep(current, 1, sizeRef.current, limitsRef.current)), [moveCamera]);
  const zoomOut = useCallback(() => moveCamera((current) => zoomStep(current, -1, sizeRef.current, limitsRef.current)), [moveCamera]);

  const screenToWorld = useCallback((screen: Point): Point => {
    const node = stage.current;
    if (!node) {
      const current = cameraRef.current;
      return { x: (screen.x - current.ox) / current.ppm, y: (current.oy - screen.y) / current.ppm };
    }
    const local = node.getAbsoluteTransform().copy().invert().point(screen);
    return { x: local.x, y: -local.y };
  }, []);

  useImperativeHandle(ref, () => ({ fit, zoomIn, zoomOut, camera: () => cameraRef.current, toWorld: screenToWorld }), [fit, zoomIn, zoomOut, screenToWorld]);

  useEffect(() => {
    const node = frame.current;
    if (!node) return;
    const measure = () => {
      const next = { w: node.clientWidth, h: node.clientHeight };
      sizeRef.current = next;
      setSize(next);
      if (!fitted.current && next.w > 0 && next.h > 0) {
        fitted.current = true;
        moveCamera(fitCamera(boundsRef.current, next, limitsRef.current));
      }
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [moveCamera]);

  // React’s onWheel is passive, so the page would scroll. Listen directly.
  useEffect(() => {
    const node = frame.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const at = localPoint(node, event);
      const factor = wheelFactor(event.deltaY, event.deltaMode, event.ctrlKey);
      moveCamera((current) => zoomAt(current, factor, at, limitsRef.current));
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [moveCamera]);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code !== "Space" || typing(event.target)) return;
      if (!frame.current?.contains(document.activeElement) && document.activeElement !== document.body) return;
      event.preventDefault();
      space.current = true;
      setGrabbing(true);
    };
    const up = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      space.current = false;
      setGrabbing(press.current.kind === "background" && press.current.panning);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    const node = frame.current;
    if (!node || isControl(event.target)) return;
    const at = localPoint(node, event);
    pointers.current.set(event.pointerId, at);
    if (pointers.current.size >= 2) {
      press.current = { kind: "pinch" };
      capture(node, event.pointerId);
      return;
    }
    const forced = space.current || event.button === 1;
    if (event.button !== 0 && !forced) {
      press.current = { kind: "shape", pointerId: event.pointerId };
      return;
    }
    if (!forced && !onBackground(stage.current, at)) {
      press.current = { kind: "shape", pointerId: event.pointerId };
      return;
    }
    if (event.button === 1) event.preventDefault();
    capture(node, event.pointerId);
    press.current = { kind: "background", pointerId: event.pointerId, start: at, last: at, panning: forced, tappable: !forced };
    if (forced) setGrabbing(true);
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const node = frame.current;
    if (!node || !pointers.current.has(event.pointerId)) return;
    const at = localPoint(node, event);
    const before = [...pointers.current.values()];
    pointers.current.set(event.pointerId, at);
    const current = press.current;
    if (current.kind === "pinch") {
      const after = [...pointers.current.values()];
      if (before.length >= 2 && after.length >= 2) {
        moveCamera((value) => pinchStep(value, [before[0]!, before[1]!], [after[0]!, after[1]!], limitsRef.current));
      }
      return;
    }
    if (current.kind !== "background" || current.pointerId !== event.pointerId) return;
    const panning = current.panning || !isTap(current.start, at);
    if (panning) {
      const dx = at.x - current.last.x;
      const dy = at.y - current.last.y;
      if (!current.panning) setGrabbing(true);
      moveCamera((value) => panBy(value, dx, dy));
    }
    press.current = { ...current, last: at, panning, tappable: current.tappable && !panning };
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const node = frame.current;
    if (!node || !pointers.current.has(event.pointerId)) return;
    const at = localPoint(node, event);
    pointers.current.delete(event.pointerId);
    const current = press.current;
    if (current.kind === "pinch") {
      // Lifting one finger of a pinch does not turn the other into a pan or a tap.
      if (pointers.current.size === 0) press.current = { kind: "idle" };
      return;
    }
    if (current.kind === "background" && current.pointerId === event.pointerId) {
      const tap = event.type === "pointerup" && current.tappable && isTap(current.start, at);
      press.current = { kind: "idle" };
      setGrabbing(space.current);
      if (tap) tapRef.current?.({ world: screenToWorld(at), screen: at, altKey: event.altKey, shiftKey: event.shiftKey });
      return;
    }
    if (pointers.current.size === 0) press.current = { kind: "idle" };
  }

  const grid = gridM ? gridLines(camera, size, gridM) : null;
  const stroke = 1 / camera.ppm;
  const topLeft = { x: -camera.ox / camera.ppm, y: -camera.oy / camera.ppm };
  const bottomRight = { x: (size.w - camera.ox) / camera.ppm, y: (size.h - camera.oy) / camera.ppm };

  return (
    <div
      ref={frame}
      data-testid={testId}
      data-ppm={camera.ppm.toFixed(3)}
      data-ox={camera.ox.toFixed(1)}
      data-oy={camera.oy.toFixed(1)}
      role="img"
      aria-label={label}
      tabIndex={0}
      className={`relative h-full min-h-0 w-full min-w-0 overflow-hidden bg-background outline-none ${grabbing ? "cursor-grabbing" : ""} ${className ?? ""}`}
      style={{ touchAction: "none" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onAuxClick={(event) => event.preventDefault()}
    >
      {size.w > 0 && size.h > 0 ? (
        <Stage ref={stage} width={size.w} height={size.h} x={camera.ox} y={camera.oy} scaleX={camera.ppm} scaleY={camera.ppm}>
          {grid ? (
            <Layer listening={false}>
              {grid.xs.map((x) => (
                <Line key={`x${x}`} points={[x, topLeft.y, x, bottomRight.y]} stroke={x === 0 ? "#3a404a" : "#2a2e36"} strokeWidth={stroke} />
              ))}
              {grid.ys.map((y) => (
                <Line key={`y${y}`} points={[topLeft.x, -y, bottomRight.x, -y]} stroke={y === 0 ? "#3a404a" : "#2a2e36"} strokeWidth={stroke} />
              ))}
            </Layer>
          ) : null}
          <Layer>{children?.(camera)}</Layer>
        </Stage>
      ) : null}
      {controls ? (
        <div data-stage-control className="absolute right-2 top-2 flex flex-col gap-2">
          <StageButton label="Zoom in" onClick={zoomIn}>+</StageButton>
          <StageButton label="Zoom out" onClick={zoomOut}>−</StageButton>
          <StageButton label="Fit" onClick={fit}>Fit</StageButton>
        </div>
      ) : null}
    </div>
  );
}

function StageButton({ label, onClick, children }: { label: string; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-card/90 text-[15px] text-foreground"
    >
      {children}
    </button>
  );
}

function localPoint(node: HTMLElement, event: { clientX: number; clientY: number }): Point {
  const box = node.getBoundingClientRect();
  return { x: event.clientX - box.left, y: event.clientY - box.top };
}

/** Empty space, or a shape named `background`, is the stage’s to pan. Anything else belongs to the shape. */
function onBackground(node: Konva.Stage | null, at: Point): boolean {
  if (!node) return true;
  const hit = node.getIntersection(at);
  return !hit || hit.hasName(BACKGROUND_NAME);
}

function capture(node: HTMLElement, pointerId: number) {
  try {
    node.setPointerCapture?.(pointerId);
  } catch {
    /* a synthetic pointer cannot be captured */
  }
}

function isControl(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("[data-stage-control]") != null;
}

function typing(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}
