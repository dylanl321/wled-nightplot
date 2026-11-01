"use client";

import { layoutStrings, yardBounds, yardPlacements, type Prop, type PropYardPoint } from "@nightplot/shared";
import type Konva from "konva";
import Link from "next/link";
import { useState } from "react";
import { Group, Line, Rect, Text } from "react-konva";
import { EditorStage, toScreen, type Camera, type Size } from "@/components/canvas";
import { placeYardLabels } from "@/components/yard-labels";
import { patchJson } from "@/lib/api";

const LIT = "#d4a574";
const PICKED = "#7ee0d0";
const SNAP_M = 0.1;

type Moving = { propId: string; at: PropYardPoint };

/**
 * The yard as a drawing: every prop's path at its yard point. Drag a prop to
 * move it; the new point is saved and read back. Nothing is sent to a
 * controller.
 */
export function YardStage({ props }: { props: Prop[] }) {
  const [saved, setSaved] = useState<Record<string, PropYardPoint>>({});
  const [moving, setMoving] = useState<Moving | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; failed: boolean } | null>(null);

  const rows = props.map((prop) => ({ ...prop, yard: saved[prop.id] ?? prop.yard }));
  const placements = yardPlacements(rows);
  const bounds = yardBounds(placements) ?? { minX: 0, minY: 0, maxX: 4, maxY: 3 };
  const pickedProp = props.find((prop) => prop.id === picked) ?? null;

  async function save(propId: string, at: PropYardPoint, quiet = false) {
    const before = saved[propId] ?? props.find((prop) => prop.id === propId)?.yard;
    setSaved((rows) => ({ ...rows, [propId]: at }));
    if (!quiet) setNote(null);
    const res = await patchJson<{ prop: Prop; message?: string }>(`/api/props/${propId}/yard`, { yard: at });
    if (!res.ok || !res.data.prop.yard) {
      setSaved((rows) => {
        const next = { ...rows };
        if (before) next[propId] = before;
        else delete next[propId];
        return next;
      });
      setNote({ text: (!res.ok && res.data.message) || "The yard did not save that spot. The prop is back where it was.", failed: true });
      return false;
    }
    const kept = res.data.prop.yard;
    setSaved((rows) => ({ ...rows, [propId]: kept }));
    if (!quiet) setNote({ text: "Saved on the yard drawing. Nothing was sent to a controller.", failed: false });
    return true;
  }

  /**
   * A prop without a saved point sits in a default slot that depends on the
   * others. Once the operator arranges the yard, keep those props where they
   * were shown, so moving one prop never makes another jump.
   */
  async function arrange(propId: string, at: PropYardPoint) {
    const shown = placements.filter((row) => row.defaulted && row.propId !== propId);
    if (!(await save(propId, at))) return;
    for (const row of shown) await save(row.propId, row.at, true);
  }

  function dragTo(propId: string, node: Konva.Node, end: boolean) {
    // The world layer is metres with y flipped; the group sits at (x, -y).
    const at = { x: snap(node.x()), y: snap(-node.y()) };
    node.position({ x: at.x, y: -at.y });
    if (!end) return setMoving({ propId, at });
    setMoving(null);
    void arrange(propId, at);
  }

  function propAt(world: { x: number; y: number }): string | null {
    let best: { id: string; area: number } | null = null;
    for (const row of placements) {
      const dx = moving?.propId === row.propId ? moving.at.x - row.at.x : 0;
      const dy = moving?.propId === row.propId ? moving.at.y - row.at.y : 0;
      const box = {
        minX: row.box.minX + dx - 0.2,
        maxX: row.box.maxX + dx + 0.2,
        minY: row.box.minY + dy - 0.2,
        maxY: row.box.maxY + dy + 0.55,
      };
      if (world.x < box.minX || world.x > box.maxX || world.y < box.minY || world.y > box.maxY) continue;
      const area = (box.maxX - box.minX) * (box.maxY - box.minY);
      if (!best || area < best.area) best = { id: row.propId, area };
    }
    return best?.id ?? null;
  }

  return (
    <section aria-label="Yard drawing" className="flex flex-col gap-2 lg:h-full lg:min-h-0">
      <div className="relative h-[46dvh] min-h-[300px] overflow-hidden rounded-[14px] border border-border lg:h-[calc(100dvh-9.5rem)] lg:min-h-0">
        <EditorStage
          bounds={bounds}
          fitMinSpanM={4}
          limits={{ minPpm: 1, maxPpm: 400 }}
          gridM={1}
          label="Yard drawing"
          testId="yard-stage"
          onBackgroundTap={() => setPicked(null)}
          onHover={(hover) => {
            const next = hover ? propAt(hover.world) : null;
            setHoverId((current) => (current === next ? current : next));
          }}
          overlay={(camera, size) => (
            <Labels
              props={rows}
              placements={placements}
              moving={moving}
              picked={picked}
              expandedId={hoverId ?? picked}
              camera={camera}
              stage={size}
            />
          )}
        >
          {() =>
            rows.map((prop) => {
              const place = placements.find((row) => row.propId === prop.id)!;
              const at = moving?.propId === prop.id ? moving.at : place.at;
              const own = { w: place.box.maxX - place.box.minX, h: place.box.maxY - place.box.minY, x: place.box.minX - place.at.x, y: place.box.minY - place.at.y };
              const chosen = picked === prop.id;
              const select = () => setPicked(prop.id);
              return (
                <Group
                  key={prop.id}
                  name="prop"
                  x={at.x}
                  y={-at.y}
                  draggable
                  onDragStart={select}
                  onDragMove={(event) => dragTo(prop.id, event.target, false)}
                  onDragEnd={(event) => dragTo(prop.id, event.target, true)}
                  onClick={select}
                  onTap={select}
                >
                  {/* The whole footprint is the handle, so a thin roofline is easy to grab. */}
                  <Rect x={own.x - 0.2} y={-(own.y + own.h) - 0.2} width={own.w + 0.4} height={own.h + 0.4} fill="transparent" stroke={chosen ? PICKED : undefined} strokeWidth={1} strokeScaleEnabled={false} dash={[4, 4]} />
                  {prop.layout ? (
                    layoutStrings(prop.layout).flatMap((string) => string.run).map((edge) => {
                      const from = prop.layout!.corners.find((corner) => corner.id === edge.from);
                      const to = prop.layout!.corners.find((corner) => corner.id === edge.to);
                      if (!from || !to || edge.kind === "hidden") return null;
                      return (
                        <Line
                          key={edge.id}
                          points={[from.x, -from.y, to.x, -to.y]}
                          stroke={colourOf(prop, edge.id) ?? LIT}
                          strokeWidth={edge.kind === "wire" ? 1 : 3}
                          dash={edge.kind === "wire" ? [0.15, 0.1] : undefined}
                          strokeScaleEnabled={false}
                          listening={false}
                        />
                      );
                    })
                  ) : (
                    <Rect x={0} y={-1} width={1} height={1} stroke={LIT} strokeWidth={2} strokeScaleEnabled={false} listening={false} />
                  )}
                </Group>
              );
            })
          }
        </EditorStage>
      </div>
      {pickedProp ? (
        <div className="flex items-center gap-2 text-[15px]">
          <p className="min-w-0 flex-1 truncate">{pickedProp.label}</p>
          <Link href={`/props/${pickedProp.id}/edit`} className="inline-flex min-h-11 items-center rounded-lg border border-border px-4">Edit path</Link>
        </div>
      ) : (
        <p className="text-[14px] text-muted-foreground">Drag a prop to where it sits in the yard. Drag empty space to pan. Nothing is sent to a controller.</p>
      )}
      {note ? (
        <p role="status" className={`text-[14px] ${note.failed ? "text-red-400" : "text-muted-foreground"}`}>{note.text}</p>
      ) : null}
    </section>
  );
}

function Labels({
  props,
  placements,
  moving,
  picked,
  expandedId,
  camera,
  stage,
}: {
  props: Prop[];
  placements: ReturnType<typeof yardPlacements>;
  moving: Moving | null;
  picked: string | null;
  expandedId: string | null;
  camera: Camera;
  stage: Size;
}) {
  const anchors = props.map((prop) => {
    const place = placements.find((row) => row.propId === prop.id)!;
    const dx = moving?.propId === prop.id ? moving.at.x - place.at.x : 0;
    const dy = moving?.propId === prop.id ? moving.at.y - place.at.y : 0;
    const top = toScreen({ x: (place.box.minX + place.box.maxX) / 2 + dx, y: place.box.maxY + dy }, camera);
    const count = prop.design?.ledCount;
    return {
      id: prop.id,
      x: top.x,
      y: top.y,
      text: `${prop.label} · ${count == null ? "count unknown" : `${count} lights`}`,
    };
  });
  const slots = placeYardLabels(anchors, { expandedId, stage: { w: stage.w, h: stage.h } });
  const expanded = slots.find((slot) => slot.id === expandedId);
  const ordered = expanded ? [...slots.filter((slot) => slot.id !== expandedId), expanded] : slots;
  return (
    <>
      {ordered.map((slot) => (
        <Text
          key={slot.id}
          text={slot.text}
          x={slot.x}
          y={slot.y}
          width={slot.width}
          align="center"
          fontSize={12}
          fill={slot.id === picked || slot.id === expandedId ? PICKED : "#e8e2d6"}
          listening={false}
          wrap="none"
          ellipsis
        />
      ))}
    </>
  );
}

function colourOf(prop: Prop, edgeId: string): string | undefined {
  return prop.sections?.find((section) => section.color && section.edgeIds.includes(edgeId))?.color;
}

function snap(value: number): number {
  return Math.round(value / SNAP_M) / Math.round(1 / SNAP_M) + 0;
}
