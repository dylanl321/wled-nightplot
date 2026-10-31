"use client";

import { snapToNet, type NetLayout, type WireframePathPoint } from "@nightplot/shared";
import { useCallback, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";

const MIN_SCALE = 0.45;
const MAX_SCALE = 8;
const TAP_SLOP_PX = 12;

type Gesture = "none" | "draw" | "pan" | "pinch";

type PointerAt = { x: number; y: number };

export function WireframeNet({
  layout,
  pathEdgeIds,
  points,
  mode,
  faceFills,
  onDrawPoint,
  onDrawEnd,
  onFaceTap,
}: {
  layout: NetLayout;
  pathEdgeIds: readonly string[];
  points: readonly WireframePathPoint[];
  mode: "draw" | "view" | "colour";
  faceFills?: Readonly<Record<number, string>>;
  onDrawPoint?: (point: WireframePathPoint) => void;
  onDrawEnd?: () => void;
  onFaceTap?: (faceIndex: number) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, PointerAt>());
  const gesture = useRef<Gesture>("none");
  const pinch = useRef<{ dist: number; mid: PointerAt; scale: number; tx: number; ty: number } | null>(null);
  const pan = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const tap = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const view = useRef({ scale: 2, tx: 10, ty: 10 });
  const [scale, setScale] = useState(2);
  const [tx, setTx] = useState(10);
  const [ty, setTy] = useState(10);

  function publish(nextScale: number, nextTx: number, nextTy: number) {
    const clamped = clampScale(nextScale);
    view.current = { scale: clamped, tx: nextTx, ty: nextTy };
    setScale(clamped);
    setTx(nextTx);
    setTy(nextTy);
  }

  const fit = useCallback(() => {
    const node = wrap.current;
    if (!node) return;
    const width = node.clientWidth;
    const height = node.clientHeight;
    if (width < 8 || height < 8) return;
    const next = clampScale((height - 20) / layout.height);
    publish(next, 10, (height - layout.height * next) / 2);
  }, [layout.height]);

  useLayoutEffect(() => {
    fit();
    const node = wrap.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => fit());
    observer.observe(node);
    return () => observer.disconnect();
  }, [fit]);

  function clientToView(clientX: number, clientY: number): PointerAt | null {
    const node = wrap.current;
    if (!node) return null;
    const box = node.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return null;
    return { x: clientX - box.left, y: clientY - box.top };
  }

  function viewToNet(at: PointerAt): PointerAt {
    const current = view.current;
    return {
      x: (at.x - current.tx) / current.scale,
      y: (at.y - current.ty) / current.scale,
    };
  }

  function applyPinch() {
    const active = [...pointers.current.values()];
    if (active.length < 2 || !pinch.current) return;
    const [first, second] = active;
    if (!first || !second) return;
    const mid = midpoint(first, second);
    const dist = distance(first, second);
    if (dist < 1) return;
    const origin = pinch.current;
    const nextScale = clampScale(origin.scale * (dist / origin.dist));
    const netX = (origin.mid.x - origin.tx) / origin.scale;
    const netY = (origin.mid.y - origin.ty) / origin.scale;
    publish(nextScale, mid.x - netX * nextScale, mid.y - netY * nextScale);
  }

  function beginPinch() {
    const active = [...pointers.current.values()];
    if (active.length < 2) return;
    const [first, second] = active;
    if (!first || !second) return;
    gesture.current = "pinch";
    pinch.current = {
      dist: Math.max(1, distance(first, second)),
      mid: midpoint(first, second),
      scale: view.current.scale,
      tx: view.current.tx,
      ty: view.current.ty,
    };
    tap.current = null;
  }

  function drawAt(event: ReactPointerEvent<HTMLDivElement>) {
    if (!onDrawPoint) return;
    const at = clientToView(event.clientX, event.clientY);
    if (!at) return;
    const net = viewToNet(at);
    const snapped = snapToNet(layout, net.x, net.y);
    if (!snapped) return;
    onDrawPoint({ x: snapped.x, y: snapped.y, edgeId: snapped.edgeId });
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const at = clientToView(event.clientX, event.clientY);
    if (!at) return;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* jsdom and emulated pointers have no active pointer id. */
    }
    pointers.current.set(event.pointerId, at);
    if (pointers.current.size >= 2) {
      beginPinch();
      return;
    }
    tap.current = { x: at.x, y: at.y, moved: false };
    if (mode === "draw") {
      gesture.current = "draw";
      drawAt(event);
      return;
    }
    gesture.current = "pan";
    pan.current = { x: at.x, y: at.y, tx: view.current.tx, ty: view.current.ty };
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const at = clientToView(event.clientX, event.clientY);
    if (!at) return;
    if (pointers.current.has(event.pointerId)) pointers.current.set(event.pointerId, at);
    if (tap.current && distance(tap.current, at) > TAP_SLOP_PX) tap.current.moved = true;
    if (pointers.current.size >= 2) {
      if (gesture.current !== "pinch") beginPinch();
      applyPinch();
      return;
    }
    if (gesture.current === "draw") {
      drawAt(event);
      return;
    }
    if (gesture.current === "pan" && pan.current) {
      publish(
        view.current.scale,
        pan.current.tx + (at.x - pan.current.x),
        pan.current.ty + (at.y - pan.current.y),
      );
    }
  }

  function endPointer(event: ReactPointerEvent<HTMLDivElement>) {
    const wasPinch = gesture.current === "pinch";
    const wasDraw = gesture.current === "draw";
    const pendingTap = tap.current;
    pointers.current.delete(event.pointerId);
    if (pointers.current.size >= 2) {
      beginPinch();
      return;
    }
    if (pointers.current.size === 1) {
      const leftover = [...pointers.current.values()][0];
      gesture.current = "pan";
      pinch.current = null;
      tap.current = null;
      if (leftover) pan.current = { x: leftover.x, y: leftover.y, tx: view.current.tx, ty: view.current.ty };
      return;
    }
    if (wasDraw) onDrawEnd?.();
    if (!wasPinch && !wasDraw && pendingTap && !pendingTap.moved && onFaceTap && mode === "colour") {
      const net = viewToNet(pendingTap);
      const face = layout.faces.find((row) => (
        net.x >= row.x && net.x <= row.x + row.width && net.y >= row.y && net.y <= row.y + row.height
      ));
      if (face) onFaceTap(face.index);
    }
    gesture.current = "none";
    pinch.current = null;
    pan.current = null;
    tap.current = null;
  }

  function onWheel(event: ReactWheelEvent<HTMLDivElement>) {
    event.preventDefault();
    const at = clientToView(event.clientX, event.clientY);
    if (!at) return;
    const current = view.current;
    const nextScale = clampScale(current.scale * (event.deltaY < 0 ? 1.12 : 1 / 1.12));
    const net = viewToNet(at);
    publish(nextScale, at.x - net.x * nextScale, at.y - net.y * nextScale);
  }

  const hint = mode === "draw"
    ? "One finger draws the pixel path. Two fingers pinch and pan the net."
    : "Pinch and pan the unfolded net. Tap a face to colour it.";

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <p id="wireframe-net-hint" className="sr-only">{hint}</p>
      <div
        ref={wrap}
        data-wireframe-net="true"
        data-scale={scale.toFixed(3)}
        data-tx={tx.toFixed(1)}
        data-ty={ty.toFixed(1)}
        role="img"
        aria-label="Unfolded box+X net"
        aria-describedby="wireframe-net-hint"
        className="relative min-h-[220px] min-w-0 flex-1 overflow-hidden overscroll-none rounded-2xl border border-border bg-[#07080a] touch-none"
        style={{ touchAction: "none", maxWidth: "100%" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onWheel={onWheel}
      >
        <svg
          width={layout.width}
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          className="pointer-events-none block max-w-none"
          style={{
            transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
            transformOrigin: "0 0",
          }}
        >
          {layout.faces.map((face) => (
            <rect
              key={face.id}
              x={face.x}
              y={face.y}
              width={face.width}
              height={face.height}
              fill={faceFills?.[face.index] ?? "#12141a"}
              stroke={mode === "colour" ? "#6fbf73" : "#2a2d36"}
            />
          ))}
          {layout.edges.map((edge) => (
            <line
              key={edge.id}
              x1={edge.x1}
              y1={edge.y1}
              x2={edge.x2}
              y2={edge.y2}
              stroke={pathEdgeIds.includes(edge.id) ? "#6fbf73" : "#5c6578"}
              strokeWidth={pathEdgeIds.includes(edge.id) ? 2.4 : 1.4}
            />
          ))}
          {points.length > 1 ? (
            <polyline
              fill="none"
              stroke="#f0c36a"
              strokeWidth={2.6}
              points={points.map((point) => `${point.x},${point.y}`).join(" ")}
            />
          ) : null}
          {mode === "colour"
            ? layout.faces.map((face) => (
                <text
                  key={`${face.id}-label`}
                  x={face.x + face.width / 2}
                  y={face.y + face.height / 2}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="#e8e6e1"
                  fontSize="16"
                >
                  {face.index + 1}
                </text>
              ))
            : null}
        </svg>
        <button
          type="button"
          aria-label="Reset net view"
          onClick={(event) => {
            event.stopPropagation();
            fit();
          }}
          onPointerDown={(event) => event.stopPropagation()}
          className="absolute top-2 right-2 min-h-11 min-w-11 touch-manipulation rounded-xl border border-input bg-[#12141a]/90 px-3 text-[13px] font-medium text-foreground"
        >
          Reset
        </button>
      </div>
    </div>
  );
}

function clampScale(value: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}

function midpoint(a: PointerAt, b: PointerAt): PointerAt {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function distance(a: PointerAt, b: PointerAt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
