"use client";

import { drawnYard, layoutStrings, yardBounds, yardPlacements, type Light, type Look, type Prop, type PropAttachment, type PropYardPoint } from "@nightplot/shared";
import type Konva from "konva";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Group, Line, Rect, Text } from "react-konva";
import { CLOSE_PPM, EditorStage, toScreen, type Camera, type Size } from "@/components/canvas";
import { YardCanvas } from "@/components/looks/yard-canvas";
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
export function YardStage({
  props,
  looks: _looks = [],
  attachments: _attachments = [],
  lights: _lights = [],
}: {
  props: Prop[];
  looks?: Look[];
  attachments?: PropAttachment[];
  lights?: Pick<Light, "id" | "outputs">[];
}) {
  const router = useRouter();
  const [saved, setSaved] = useState<Record<string, PropYardPoint>>({});
  const [moving, setMoving] = useState<Moving | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; failed: boolean } | null>(null);
  const [mode, setMode] = useState<"2d" | "street">("2d");

  const rows = props.map((prop) => ({ ...prop, yard: saved[prop.id] ?? prop.yard }));
  const placements = yardPlacements(rows);
  const bounds = yardBounds(placements) ?? { minX: 0, minY: 0, maxX: 4, maxY: 3 };
  const pickedProp = props.find((prop) => prop.id === picked) ?? null;
  const pickedAt = pickedProp ? placements.find((row) => row.propId === pickedProp.id)?.at ?? null : null;

  async function save(propId: string, at: PropYardPoint, quiet = false) {
    const before = saved[propId] ?? props.find((prop) => prop.id === propId)?.yard;
    const next = { ...(before ?? {}), ...at, x: at.x, y: at.y };
    setSaved((rows) => ({ ...rows, [propId]: next }));
    if (!quiet) setNote(null);
    const res = await patchJson<{ prop: Prop; message?: string }>(`/api/props/${propId}/yard`, { yard: next });
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
    if (!(await save(propId, at))) return false;
    for (const row of shown) await save(row.propId, row.at, true);
    return true;
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
      <div role="group" aria-label="Yard view" className="flex w-fit overflow-hidden rounded-lg border border-border">
        <button type="button" aria-pressed={mode === "2d"} className={modeButton(mode === "2d")} onClick={() => setMode("2d")}>2D</button>
        <button type="button" aria-pressed={mode === "street"} className={modeButton(mode === "street")} onClick={() => setMode("street")}>Street</button>
      </div>
      <div className="relative h-[46dvh] min-h-[300px] overflow-hidden rounded-[14px] border border-border lg:h-[calc(100dvh-12rem)] lg:min-h-0">
        {mode === "street" ? (
          <YardCanvas
            drawn={drawnYard(rows)}
            props={rows}
            look={null}
            neutral
            depth
            className="absolute inset-0 h-full w-full touch-none"
            ariaLabel="Yard from the street"
            onPick={(hit) => setPicked(hit?.propId ?? null)}
          />
        ) : (
        <EditorStage
          bounds={bounds}
          fitMinSpanM={4}
          limits={{ minPpm: 1, maxPpm: CLOSE_PPM }}
          gridM={1}
          axes
          label="Yard drawing"
          testId="yard-stage"
          onBackgroundTap={() => setPicked(null)}
          onHover={(hover) => {
            const next = hover ? propAt(hover.world) : null;
            setHoverId((current) => (current === next ? current : next));
          }}
          overlay={(camera, size) => (
            <>
              <Labels
                props={rows}
                placements={placements}
                moving={moving}
                picked={picked}
                expandedId={hoverId ?? picked}
                camera={camera}
                stage={size}
              />
              {moving ? (
                <Text
                  text={positionText(moving.at)}
                  x={toScreen(moving.at, camera).x + 10}
                  y={toScreen(moving.at, camera).y + 8}
                  fontSize={12}
                  fill={PICKED}
                  listening={false}
                />
              ) : null}
            </>
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
                  onDblClick={() => router.push(`/props/${prop.id}/edit`)}
                  onDblTap={() => router.push(`/props/${prop.id}/edit`)}
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
        )}
      </div>
      {pickedProp ? (
        <div className="flex flex-col gap-2 text-[15px]">
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate">{pickedProp.label}</p>
            <Link href={`/props/${pickedProp.id}/edit`} className="inline-flex min-h-11 items-center rounded-lg border border-border px-4">Edit path</Link>
          </div>
          {mode === "2d" ? (
            <PositionFields
              key={`${pickedProp.id}:${pickedAt?.x}:${pickedAt?.y}`}
              name={pickedProp.label}
              at={pickedAt ?? { x: 0, y: 0 }}
              onSave={(at) => { void arrange(pickedProp.id, at); }}
            />
          ) : null}
        </div>
      ) : (
        <p className="text-[14px] text-muted-foreground">
          {mode === "street"
            ? "Drag to look a little left or right. Pinch or the wheel zooms. Street is eye height. Nothing is sent to a controller."
            : "Drag a prop to where it sits in the yard, or pick it and type where it goes. One square is 1 m; the ring is the origin. A mouse wheel zooms. A trackpad scroll pans. Pinch, or Ctrl and scroll, zooms toward the pointer. Nothing is sent to a controller."}
        </p>
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

function modeButton(on: boolean): string {
  return `min-h-11 min-w-11 px-3 text-[15px] ${on ? "bg-primary text-primary-foreground" : "text-foreground"}`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100 + 0;
}

function positionText(at: PropYardPoint): string {
  return `${round2(at.x)} m right, ${round2(at.y)} m up`;
}

/**
 * Where the picked prop's start point sits, in metres from the origin. Typed
 * values go through the same save and read-back as a drag.
 */
export function PositionFields({ name, at, onSave }: { name: string; at: PropYardPoint; onSave: (at: PropYardPoint) => Promise<void> | void }) {
  const [x, setX] = useState(String(round2(at.x)));
  const [y, setY] = useState(String(round2(at.y)));
  const nx = Number(x);
  const ny = Number(y);
  const valid = x.trim() !== "" && y.trim() !== "" && Number.isFinite(nx) && Number.isFinite(ny) && Math.abs(nx) <= 10000 && Math.abs(ny) <= 10000;
  const changed = valid && (round2(nx) !== round2(at.x) || round2(ny) !== round2(at.y));
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (changed) void onSave({ x: round2(nx), y: round2(ny) });
      }}
    >
      <label className="flex w-28 flex-col gap-1 text-[13px] text-muted-foreground">
        Right of origin (m)
        <input aria-label={`${name} metres right of the origin`} inputMode="decimal" value={x} onChange={(event) => setX(event.target.value)}
          className="min-h-11 rounded-md border border-input bg-[#07080a] px-3 text-base text-foreground outline-none focus:border-primary" />
      </label>
      <label className="flex w-28 flex-col gap-1 text-[13px] text-muted-foreground">
        Up from origin (m)
        <input aria-label={`${name} metres up from the origin`} inputMode="decimal" value={y} onChange={(event) => setY(event.target.value)}
          className="min-h-11 rounded-md border border-input bg-[#07080a] px-3 text-base text-foreground outline-none focus:border-primary" />
      </label>
      <button type="submit" disabled={!changed} className="min-h-11 rounded-lg border border-border px-4 disabled:opacity-50">Move</button>
      {!valid ? <p className="w-full text-[13px] text-destructive">Type a number of metres for each.</p> : null}
    </form>
  );
}

function snap(value: number): number {
  return Math.round(value / SNAP_M) / Math.round(1 / SNAP_M) + 0;
}
