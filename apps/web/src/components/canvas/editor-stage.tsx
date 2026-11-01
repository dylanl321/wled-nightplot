"use client";

import type Konva from "konva";
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { Circle, Layer, Line, Stage, Text } from "react-konva";
import {
  BACKGROUND_NAME,
  PINCH_ATTR,
  CONTROLS_INSET_PX,
  DEFAULT_LIMITS,
  fitCamera,
  gridLines,
  type FitPad,
  isTap,
  panBy,
  pinchStep,
  wheelFactor,
  wheelGesture,
  zoomAt,
  zoomLimited,
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
  /** Keep the zoom and put this world point in the middle of the view. */
  centerOn: (world: Point) => void;
  camera: () => Camera;
  /** Screen px (relative to the stage) to world metres, through the inverted stage transform. */
  toWorld: (screen: Point) => Point;
};

export type EditorStageProps = {
  /** The world box Fit frames, in metres. */
  bounds: Bounds;
  limits?: ZoomLimits;
  /** Fit never frames less than this many metres, so one corner is not a wall of pixels. */
  fitMinSpanM?: number;
  /** Grid step in metres. Leave out for no grid. */
  gridM?: number;
  /** Accessible name of the drawing. */
  label: string;
  testId?: string;
  /** Show Zoom in, Zoom out, and Fit. On by default. */
  controls?: boolean;
  /** Extra screen px Fit keeps clear, on top of the margin and the zoom-button inset. */
  fitPad?: FitPad;
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
  /**
   * Screen-space content drawn above the world, in stage pixels. Use it for
   * handles, badges, and text that keep one size at every zoom.
   */
  overlay?: (camera: Camera, size: Size) => ReactNode;
  /** Mark the origin and label the grid lines in metres along the edges. */
  axes?: boolean;
  /** A mouse moving with no button down, in world metres. `null` when it leaves. */
  onHover?: (hover: { world: Point; altKey: boolean; shiftKey: boolean } | null) => void;
};

type Press =
  | { kind: "idle" }
  /** One pointer on empty space: a tap until it moves past the slop, then a pan. */
  | { kind: "background"; pointerId: number; start: Point; last: Point; panning: boolean; tappable: boolean }
  | { kind: "pinch" }
  /** A press a shape owns (a corner, a run, a prop). The stage does nothing with it. */
  | { kind: "shape"; pointerId: number };

/**
 * One Konva stage for the path editor, Name sections, and the yard. A mouse
 * wheel zooms toward the pointer. A trackpad scroll pans. Pinch, or Ctrl / ⌘
 * with the wheel, zooms. Background, space, and middle-button drag pan.
 * Zoom in, Zoom out, and Fit sit in the corner. The camera lives here.
 */
export function EditorStage({
  bounds,
  limits = DEFAULT_LIMITS,
  fitMinSpanM = 0.5,
  gridM,
  label,
  testId = "editor-stage",
  controls = true,
  fitPad,
  className,
  ref,
  onBackgroundTap,
  onCameraChange,
  children,
  overlay,
  onHover,
  axes = false,
}: EditorStageProps) {
  const frame = useRef<HTMLDivElement>(null);
  const stage = useRef<Konva.Stage>(null);
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  const [camera, setCamera] = useState<Camera>({ ppm: 50, ox: 0, oy: 0 });
  const [grabbing, setGrabbing] = useState(false);
  const [limitNote, setLimitNote] = useState<string | null>(null);
  const limitTimer = useRef<number | null>(null);
  const cameraRef = useRef(camera);
  const sizeRef = useRef(size);
  const boundsRef = useRef(bounds);
  const limitsRef = useRef(limits);
  const spanRef = useRef(fitMinSpanM);
  const insetRef = useRef(controls ? CONTROLS_INSET_PX : 0);
  const padRef = useRef(fitPad);
  const pointers = useRef(new Map<number, Point>());
  const press = useRef<Press>({ kind: "idle" });
  const space = useRef(false);
  const fitted = useRef(false);
  const tapRef = useRef(onBackgroundTap);
  const changeRef = useRef(onCameraChange);
  const hoverRef = useRef(onHover);
  // Pointer and wheel handlers read the latest props without re-binding.
  useLayoutEffect(() => {
    boundsRef.current = bounds;
    limitsRef.current = limits;
    spanRef.current = fitMinSpanM;
    insetRef.current = controls ? CONTROLS_INSET_PX : 0;
    padRef.current = fitPad;
    tapRef.current = onBackgroundTap;
    changeRef.current = onCameraChange;
    hoverRef.current = onHover;
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
    moveCamera(fitCamera(boundsRef.current, current, limitsRef.current, { minSpanM: spanRef.current, rightInset: insetRef.current, pad: padRef.current }));
  }, [moveCamera]);

  const sayLimit = useCallback((kind: "in" | "out" | null) => {
    if (!kind) return;
    setLimitNote(kind === "in" ? "That's as close as it goes." : "That's as far as it goes.");
    if (limitTimer.current != null) window.clearTimeout(limitTimer.current);
    limitTimer.current = window.setTimeout(() => setLimitNote(null), 1200);
  }, []);
  const zoomIn = useCallback(() => moveCamera((current) => {
    const next = zoomStep(current, 1, sizeRef.current, limitsRef.current);
    if (next.ppm <= current.ppm + 1e-6) sayLimit("in");
    return next;
  }), [moveCamera, sayLimit]);
  const zoomOut = useCallback(() => moveCamera((current) => {
    const next = zoomStep(current, -1, sizeRef.current, limitsRef.current);
    if (next.ppm >= current.ppm - 1e-6) sayLimit("out");
    return next;
  }), [moveCamera, sayLimit]);
  const centerOn = useCallback((world: Point) => {
    const size = sizeRef.current;
    moveCamera((current) => ({
      ppm: current.ppm,
      ox: size.w / 2 - world.x * current.ppm,
      oy: size.h / 2 + world.y * current.ppm,
    }));
  }, [moveCamera]);

  const screenToWorld = useCallback((screen: Point): Point => {
    const node = stage.current;
    if (!node) {
      const current = cameraRef.current;
      return { x: (screen.x - current.ox) / current.ppm, y: (current.oy - screen.y) / current.ppm };
    }
    const local = node.getAbsoluteTransform().copy().invert().point(screen);
    return { x: local.x, y: -local.y };
  }, []);

  useImperativeHandle(ref, () => ({ fit, zoomIn, zoomOut, centerOn, camera: () => cameraRef.current, toWorld: screenToWorld }), [fit, zoomIn, zoomOut, centerOn, screenToWorld]);

  useEffect(() => {
    const node = frame.current;
    if (!node) return;
    const measure = () => {
      const next = { w: node.clientWidth, h: node.clientHeight };
      sizeRef.current = next;
      setSize(next);
      if (!fitted.current && next.w > 0 && next.h > 0) {
        fitted.current = true;
        moveCamera(fitCamera(boundsRef.current, next, limitsRef.current, { minSpanM: spanRef.current, rightInset: insetRef.current, pad: padRef.current }));
      }
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [moveCamera]);

  // React’s onWheel is passive, so the page would scroll. Listen directly.
  // A mouse wheel zooms. A trackpad scroll pans. Pinch or Ctrl zooms.
  useEffect(() => {
    const node = frame.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const gesture = wheelGesture({
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        deltaMode: event.deltaMode,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
      });
      if (gesture === "pan") {
        moveCamera((current) => panBy(current, -event.deltaX, -event.deltaY));
        return;
      }
      const at = localPoint(node, event);
      const factor = wheelFactor(event.deltaY, event.deltaMode, event.ctrlKey);
      sayLimit(zoomLimited(cameraRef.current.ppm, factor, limitsRef.current));
      moveCamera((current) => zoomAt(current, factor, at, limitsRef.current));
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [moveCamera, sayLimit]);

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
    if (pointers.current.size === 1) stage.current?.setAttr(PINCH_ATTR, false);
    if (pointers.current.size >= 2) {
      press.current = { kind: "pinch" };
      // A second finger cancels any shape drag the first finger started: the
      // corner or light goes back where it was and nothing is saved.
      stage.current?.setAttr(PINCH_ATTR, true);
      stage.current?.find((node: Konva.Node) => node.isDragging()).forEach((node) => node.stopDrag());
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
    if (!node) return;
    if (!pointers.current.has(event.pointerId)) {
      if (event.pointerType === "mouse" && event.buttons === 0 && hoverRef.current) {
        hoverRef.current({ world: screenToWorld(localPoint(node, event)), altKey: event.altKey, shiftKey: event.shiftKey });
      }
      return;
    }
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
      onPointerLeave={() => hoverRef.current?.(null)}
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
          {axes ? <Axes camera={camera} size={size} stepM={axisStep(gridM ?? 1, camera.ppm)} /> : null}
          <Layer>{children?.(camera)}</Layer>
          {overlay ? (
            // Undo the stage transform so this layer is in stage pixels.
            <Layer x={-camera.ox / camera.ppm} y={-camera.oy / camera.ppm} scaleX={1 / camera.ppm} scaleY={1 / camera.ppm}>
              {overlay(camera, size)}
            </Layer>
          ) : null}
        </Stage>
      ) : null}
      {limitNote ? (
        <p role="status" className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-md bg-card/90 px-2 py-1 text-[12px] text-muted-foreground">
          {limitNote}
        </p>
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

const AXIS = "#7a8290";

/** Grid labels at least 48 px apart: the grid step, or a multiple of it. */
function axisStep(gridM: number, ppm: number): number {
  let step = gridM;
  while (step * ppm < 48) step *= step / gridM >= 5 ? 2 : 5;
  return step;
}

function axisLabel(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return `${rounded === 0 ? 0 : rounded} m`;
}

/**
 * The origin and grid labels, in stage pixels: x along the bottom edge, y
 * along the left edge, and a ring at (0, 0) when it is in view.
 */
function Axes({ camera, size, stepM }: { camera: Camera; size: Size; stepM: number }) {
  const left = -camera.ox / camera.ppm;
  const right = (size.w - camera.ox) / camera.ppm;
  const top = camera.oy / camera.ppm;
  const bottom = (camera.oy - size.h) / camera.ppm;
  const xs: number[] = [];
  for (let x = Math.ceil(left / stepM) * stepM; x <= right && xs.length < 200; x += stepM) xs.push(x);
  const ys: number[] = [];
  for (let y = Math.ceil(bottom / stepM) * stepM; y <= top && ys.length < 200; y += stepM) ys.push(y);
  const origin = { x: camera.ox, y: camera.oy };
  const originShown = origin.x >= 0 && origin.x <= size.w && origin.y >= 0 && origin.y <= size.h;
  return (
    <Layer listening={false} x={-camera.ox / camera.ppm} y={-camera.oy / camera.ppm} scaleX={1 / camera.ppm} scaleY={1 / camera.ppm}>
      {originShown ? (
        <>
          <Line points={[origin.x, 0, origin.x, size.h]} stroke={AXIS} strokeWidth={1} opacity={0.6} />
          <Line points={[0, origin.y, size.w, origin.y]} stroke={AXIS} strokeWidth={1} opacity={0.6} />
          <Circle x={origin.x} y={origin.y} radius={5} stroke="#e8e2d6" strokeWidth={1.5} />
          <Text x={origin.x + 7} y={origin.y + 5} text="Origin" fontSize={11} fill="#e8e2d6" />
        </>
      ) : null}
      {xs.map((x) => (
        <Text key={`ax${x}`} x={origin.x + x * camera.ppm - 24} y={size.h - 16} width={48} align="center" text={axisLabel(x)} fontSize={10} fill={AXIS} />
      ))}
      {ys.map((y) => (
        <Text key={`ay${y}`} x={4} y={origin.y - y * camera.ppm - 5} text={axisLabel(y)} fontSize={10} fill={AXIS} />
      ))}
    </Layer>
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
