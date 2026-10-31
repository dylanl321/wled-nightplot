"use client";

import { propKindLabel, type Element, type LightDetail, type Prop } from "@nightplot/shared";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { deleteJson, patchJson } from "@/lib/api";
import { WireframeFlow } from "@/components/props/wireframe-flow";

export function PropList({
  lightId,
  lightName,
  ledCount,
  rgbw,
  unreachable,
  props,
  elements,
  disabled,
  disabledReason,
  onAdd,
  onDetail,
  onNotice,
  openWireframe = false,
}: {
  lightId: string;
  lightName: string;
  ledCount: number;
  rgbw: boolean;
  unreachable: boolean;
  props: Prop[];
  elements: Element[];
  disabled: boolean;
  disabledReason?: string;
  onAdd: () => void;
  onDetail: (next: LightDetail) => void;
  onNotice: (notice: string | null) => void;
  openWireframe?: boolean;
}) {
  const wireframe = openWireframe ? props.find((prop) => prop.kind === "wireframe" && prop.wireframe) ?? null : null;
  const [editing, setEditing] = useState<Prop | null>(wireframe);
  return (
    <section aria-label="Props" className="rounded-[14px] border border-border bg-[#0e1014]">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <h3 className="text-[15px] font-medium">Props</h3>
        <p className="text-[12px] text-muted-foreground">Named shapes on this Light. Gaps between their Segments stay unused.</p>
        <Button
          type="button"
          className="h-11 w-full px-4 text-[15px] sm:ml-auto sm:h-[34px] sm:w-auto sm:px-3 sm:text-[13px]"
          onClick={onAdd}
          disabled={disabled}
          title={disabledReason}
        >
          Add prop
        </Button>
      </div>
      {props.length === 0 ? (
        <p className="px-4 py-3 text-[13px] text-muted-foreground">No Props yet. Add a shape, or a wireframe box+X, and mark it on the lit strip.</p>
      ) : (
        <ul>
          {props.map((prop) => (
            <PropRow
              key={prop.id}
              lightId={lightId}
              prop={prop}
              elements={elements}
              disabled={disabled}
              onDetail={onDetail}
              onNotice={onNotice}
              onCorrect={prop.kind === "wireframe" ? () => setEditing(prop) : undefined}
            />
          ))}
        </ul>
      )}
      {editing ? (
        <WireframeFlow
          lightId={lightId}
          lightName={lightName}
          ledCount={ledCount}
          rgbw={rgbw}
          unreachable={unreachable}
          existing={editing}
          initialPhase="lock"
          onClose={() => setEditing(null)}
          onApplied={(payload) => {
            onDetail(payload);
            if (payload.prop) setEditing(payload.prop);
          }}
        />
      ) : null}
    </section>
  );
}

function PropRow({
  lightId,
  prop,
  elements,
  disabled,
  onDetail,
  onNotice,
  onCorrect,
}: {
  lightId: string;
  prop: Prop;
  elements: Element[];
  disabled: boolean;
  onDetail: (next: LightDetail) => void;
  onNotice: (notice: string | null) => void;
  onCorrect?: () => void;
}) {
  const [label, setLabel] = useState(prop.label);
  const [busy, setBusy] = useState(false);
  const sides = prop.elementIds
    .map((id) => elements.find((element) => element.id === id))
    .filter((element): element is Element => Boolean(element));
  const dirty = label.trim() !== prop.label;

  async function rename() {
    const next = label.trim();
    if (!next || next === prop.label) return;
    setBusy(true);
    onNotice(null);
    const res = await patchJson<LightDetail>(`/api/lights/${lightId}/props/${prop.id}`, { label: next });
    setBusy(false);
    if (!res.ok) {
      onNotice(res.data.message ?? "Prop was not renamed.");
      return;
    }
    onDetail(res.data);
  }

  async function remove() {
    setBusy(true);
    onNotice(null);
    const res = await deleteJson<LightDetail>(`/api/lights/${lightId}/props/${prop.id}`);
    setBusy(false);
    if (!res.ok) {
      onNotice(res.data.message ?? "Prop was not removed.");
      return;
    }
    onDetail(res.data);
  }

  return (
    <li className="flex flex-col gap-2 border-b border-border px-4 py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-md bg-secondary px-2 py-1 text-[12px] text-muted-foreground">{propKindLabel(prop.kind)}</span>
        <input
          aria-label={`Rename ${prop.label}`}
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          className="h-9 min-w-[10rem] flex-1 rounded-md border border-input bg-[#07080a] px-3 text-[14px] text-foreground outline-none focus:border-primary"
        />
        <Button type="button" variant="outline" className="h-9 text-[13px]" onClick={() => void rename()} disabled={disabled || busy || !dirty || !label.trim()}>
          {busy ? "Saving…" : "Rename"}
        </Button>
        {onCorrect ? (
          <Button type="button" variant="outline" className="h-9 text-[13px]" onClick={onCorrect} disabled={disabled || busy}>
            Correct wireframe
          </Button>
        ) : null}
        <Button type="button" variant="outline" className="h-9 text-[13px]" onClick={() => void remove()} disabled={disabled || busy}>
          Remove
        </Button>
      </div>
      <p className="text-[13px] text-muted-foreground">
        {sides.length === 0
          ? "No Segments remain on this Prop."
          : sides.map((side) => `${side.label} ${side.start}–${side.stop}`).join(" · ")}
      </p>
    </li>
  );
}
