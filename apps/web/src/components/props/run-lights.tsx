"use client";

import { alongRun, layoutStrings, pointOnRun, stringLights, type PropLayout, type StringLight } from "@nightplot/shared";
import type Konva from "konva";
import { Circle, Group, Text } from "react-konva";
import { endedByPinch, toScreen, type Camera, type Point } from "@/components/canvas";

/** One spacing, in pixels, before numbered dots are drawn. */
export const LIGHT_DOT_MIN_PX = 16;

const INK = "#e8e2d6";

export type LightPick = { edgeId: string; id: string | null; station: number };

export type LightSlide = LightPick & { alongM: number };

/**
 * Dots appear once a spacing is at least 16 px. While the whole prop still
 * fits, they wait until a spacing is large enough to grab, so a fitted
 * drawing stays the line and the badges.
 */
export function showLightDots(pitchM: number, ppm: number, fits: boolean): boolean {
  const spacingPx = pitchM * ppm;
  if (spacingPx < LIGHT_DOT_MIN_PX) return false;
  if (!fits) return true;
  return spacingPx >= 64;
}

/** A run that misses the stage entirely is not drawn. One that crosses it is. */
export function runOnScreen(a: Point, b: Point, size: { w: number; h: number }): boolean {
  const pad = 24;
  const left = -pad;
  const right = size.w + pad;
  const top = -pad;
  const bottom = size.h + pad;
  const outside = (point: Point) => point.x < left || point.x > right || point.y < top || point.y > bottom;
  if (!outside(a) || !outside(b)) return true;
  if (a.x < left && b.x < left) return false;
  if (a.x > right && b.x > right) return false;
  if (a.y < top && b.y < top) return false;
  if (a.y > bottom && b.y > bottom) return false;
  return true;
}

/**
 * Numbered dots for lit runs that are on screen and zoomed in far enough.
 * The number is the light's place on the string, from 0 at the wire-in.
 * Dragging stays on that run.
 */
export function RunLightLayer({
  layout,
  camera,
  size,
  fits,
  selected,
  slide,
  onSelect,
  onDrag,
}: {
  layout: PropLayout;
  camera: Camera;
  size: { w: number; h: number };
  fits: boolean;
  selected: LightPick | null;
  slide: LightSlide | null;
  onSelect: (pick: LightPick) => void;
  onDrag: (pick: LightPick, alongM: number, done: boolean, cancelled?: boolean) => void;
}) {
  if (!showLightDots(layout.pitchM, camera.ppm, fits)) return null;
  const byEdge = new Map<string, StringLight[]>();
  for (const mark of stringLights(layout)) {
    const list = byEdge.get(mark.edgeId) ?? [];
    list.push(mark);
    byEdge.set(mark.edgeId, list);
  }
  const nodes = [];
  for (const [edgeId, row] of byEdge) {
    const edge = layoutStrings(layout).flatMap((string) => string.run).find((item) => item.id === edgeId);
    if (!edge || edge.kind !== "lit" || row.length === 0) continue;
    const from = layout.corners.find((corner) => corner.id === edge.from);
    const to = layout.corners.find((corner) => corner.id === edge.to);
    if (!from || !to) continue;
    if (!runOnScreen(toScreen(from, camera), toScreen(to, camera), size)) continue;
    const shown = row.map((mark, station) => {
      const moving = slide != null && slide.edgeId === edgeId && (slide.id != null ? mark.id === slide.id : station === slide.station);
      if (!moving || !slide) return { mark, station };
      const at = pointOnRun(from, to, slide.alongM);
      return { mark: { ...mark, alongM: slide.alongM, x: at.x, y: at.y }, station };
    });
    const order = [...shown].sort((left, right) => left.mark.alongM - right.mark.alongM || left.station - right.station);
    const start = Math.min(...row.map((mark) => mark.index));
    for (const item of shown) {
      const at = toScreen({ x: item.mark.x, y: item.mark.y }, camera);
      const pick = { edgeId, id: item.mark.id, station: item.station };
      const isSelected = selected?.edgeId === edgeId && (selected.id != null ? selected.id === item.mark.id : selected.station === item.station);
      const place = order.findIndex((entry) => entry.station === item.station);
      nodes.push(
        <LightDot
          key={`${edgeId}:${item.mark.id ?? item.station}`}
          x={at.x}
          y={at.y}
          label={String(start + place)}
          selected={isSelected}
          onSelect={() => onSelect(pick)}
          onDrag={(event, done) => {
            if (endedByPinch(event)) {
              // A pinch began on this light: put it back and save nothing.
              if (!done) { event.target.stopDrag(); return; }
              const home = row[item.station];
              if (home) event.target.position(toScreen({ x: home.x, y: home.y }, camera));
              onDrag(pick, home?.alongM ?? item.mark.alongM, true, true);
              return;
            }
            const pointer = event.target.getStage()?.getPointerPosition();
            const world = pointer ? screenToWorld(pointer, camera) : screenToWorld(event.target.position(), camera);
            const along = alongRun(from, to, world);
            event.target.position(toScreen(pointOnRun(from, to, along), camera));
            onDrag(pick, along, done);
          }}
        />,
      );
    }
  }
  return <>{nodes}</>;
}

function LightDot({
  x,
  y,
  label,
  selected,
  onSelect,
  onDrag,
}: {
  x: number;
  y: number;
  label: string;
  selected: boolean;
  onSelect: () => void;
  onDrag: (event: Konva.KonvaEventObject<DragEvent>, done: boolean) => void;
}) {
  return (
    <Group
      x={x}
      y={y}
      draggable
      dragDistance={4}
      onMouseDown={(event) => { event.cancelBubble = true; }}
      onTouchStart={(event) => { event.cancelBubble = true; }}
      onClick={(event) => { event.cancelBubble = true; onSelect(); }}
      onTap={(event) => { event.cancelBubble = true; onSelect(); }}
      onDragStart={(event) => {
        event.cancelBubble = true;
        // A drag that only starts once a pinch is under way is not a drag.
        if (endedByPinch(event)) { event.target.stopDrag(); return; }
        onSelect();
      }}
      onDragMove={(event) => onDrag(event, false)}
      onDragEnd={(event) => onDrag(event, true)}
    >
      <Circle radius={22} fill="transparent" />
      <Circle radius={selected ? 9 : 7} fill={selected ? "#f4efe6" : "#12141a"} stroke={selected ? "#f4efe6" : "#d4a574"} strokeWidth={2} />
      <Text text={label} fontSize={10} fill={selected ? "#0c0d10" : INK} width={24} offsetX={12} offsetY={5} align="center" listening={false} />
    </Group>
  );
}

function screenToWorld(screen: Point, camera: Camera): Point {
  return { x: (screen.x - camera.ox) / camera.ppm, y: (camera.oy - screen.y) / camera.ppm };
}
