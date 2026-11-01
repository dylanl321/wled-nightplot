"use client";

import {
  defaultSections,
  isPropLayout,
  layoutFromMeasurements,
  reconcileSections,
  type Prop,
  type PropLayout,
  type PropMeasurements,
  type PropSection,
} from "@nightplot/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PropLayoutEditor } from "@/components/props/prop-layout-editor";
import { PropSectionsStep } from "@/components/props/prop-sections";
import { Button } from "@/components/ui/button";
import { patchJson } from "@/lib/api";

export function EditProp({ prop, start = "draw" }: { prop: Prop; start?: "draw" | "sections" }) {
  const router = useRouter();
  const initial = prop.layout && isPropLayout(prop.layout) ? prop.layout : layoutFromDesign(prop);
  const [notice, setNotice] = useState<string | null>(null);
  const [phase, setPhase] = useState<"draw" | "sections">(start);
  const [layout, setLayout] = useState<PropLayout | null>(initial);
  const [sections, setSections] = useState<PropSection[]>(prop.sections ?? (initial ? defaultSections(initial) : []));
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [pathNote, setPathNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!initial || !layout) {
    return (
      <div className="mx-auto max-w-[560px] px-4 py-8">
        <h1 className="text-[26px] font-semibold">{prop.label}</h1>
        <p className="mt-2 text-[15px] text-muted-foreground">This prop has no drawing to edit.</p>
      </div>
    );
  }
  if (phase === "sections") {
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col overflow-x-hidden lg:max-w-[1200px]">
        <header className="flex h-14 shrink-0 items-center gap-1 px-1">
          <button type="button" className="min-h-11 px-3 text-[16px]" onClick={() => (start === "sections" ? router.push("/") : setPhase("draw"))}>Back</button>
          <p className="min-w-0 flex-1 truncate text-[17px] font-medium">{prop.label}</p>
        </header>
        <div className="flex flex-1 flex-col gap-5 overflow-x-hidden px-4 pb-28">
          <h1 className="text-[26px] font-semibold tracking-[-0.01em]">Name the sections</h1>
          {pathNote ? <p role="status" className="rounded-lg border border-border bg-card px-3 py-2 text-[15px] leading-6">{pathNote}</p> : null}
          <PropSectionsStep
            layout={layout}
            sections={sections}
            measurements={prop.design?.measurements ?? { shape: "custom" }}
            onLayout={setLayout}
            onSections={setSections}
            onInvalid={setRangeError}
          />
          {notice ? <p className="text-[15px] text-destructive">{notice}</p> : null}
        </div>
        <div className="fixed inset-x-0 bottom-0 z-20 mx-auto flex w-full max-w-[560px] gap-2 border-t border-border bg-background px-4 py-3 lg:max-w-[1200px] lg:justify-end">
          <Button type="button" variant="outline" className="min-h-11 flex-1 text-base lg:max-w-[200px]" onClick={() => setPhase("draw")}>Edit path</Button>
          <Button type="button" className="min-h-11 flex-1 text-base lg:max-w-[200px]" disabled={busy || Boolean(rangeError)} onClick={() => void save(layout, sections)}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <>
      {notice ? <p className="px-4 pt-4 text-[15px] text-destructive">{notice}</p> : null}
      <PropLayoutEditor
        name={prop.label}
        initial={layout}
        mode={prop.kind === "custom" ? "trace" : "edit"}
        doneLabel="Name sections"
        backLabel="Save and back"
        onBack={async (next) => {
          const res = await patchJson(`/api/props/${prop.id}`, {
            layout: next,
            measurements: prop.design?.measurements ?? { shape: "custom" },
          });
          if (!res.ok) {
            setNotice(res.data.message ?? "The drawing was not saved.");
            return;
          }
          router.push("/");
          router.refresh();
        }}
        onDone={(next) => {
          setLayout(next);
          if (sections.length === 0) {
            setSections(defaultSections(next));
            setPathNote(null);
          } else {
            const fixed = reconcileSections(next, sections, initial ?? undefined);
            setSections(fixed.sections);
            setPathNote(pathChangeNote(fixed.added, fixed.dropped.length));
          }
          setPhase("sections");
        }}
      />
    </>
  );

  async function save(nextLayout: PropLayout, nextSections: PropSection[]) {
    setBusy(true);
    setNotice(null);
    const res = await patchJson(`/api/props/${prop.id}`, {
      layout: nextLayout,
      measurements: prop.design?.measurements ?? { shape: "custom" },
      sections: nextSections,
    });
    setBusy(false);
    if (!res.ok) {
      setNotice(res.data.message ?? "The drawing was not saved.");
      return;
    }
    router.push("/");
    router.refresh();
  }
}

function pathChangeNote(added: string[], dropped: number): string | null {
  const parts: string[] = [];
  if (added.length > 0) {
    parts.push(added.length === 1
      ? `The path has a new edge, so it has its own section: ${added[0]}. Rename it, or tap the edge to move it into another section.`
      : `The path has ${added.length} new edges, so each has its own section: ${added.join(", ")}. Rename them, or tap an edge to move it into another section.`);
  }
  if (dropped > 0) parts.push(dropped === 1 ? "A deleted edge was taken out of its section." : `${dropped} deleted edges were taken out of their sections.`);
  return parts.length > 0 ? parts.join(" ") : null;
}

function layoutFromDesign(prop: Prop): PropLayout | null {
  const design = prop.design;
  if (!design) return null;
  const measurements = design.measurements;
  if (measurements.shape === "custom" || measurements.shape === "legacy") return null;
  const params = paramsOf(measurements);
  if (!params || design.pitchMm == null) return null;
  return layoutFromMeasurements({
    units: design.unit,
    pitchM: design.pitchMm / 1000,
    shape: measurements.shape,
    params,
  });
}

function paramsOf(measurements: PropMeasurements): Record<string, number> | null {
  switch (measurements.shape) {
    case "roofline":
      return { length: measurements.length };
    case "window":
      return { width: measurements.width, height: measurements.height };
    case "arch":
      return { width: measurements.width, height: measurements.height };
    case "tree":
      return { height: measurements.height, base: measurements.base };
    case "stake-row":
      return { stakes: measurements.stakes, height: measurements.height };
    case "wireframe":
      return { sides: measurements.sides, side: measurements.side, height: measurements.height };
    case "custom":
    case "legacy":
      return null;
    default: {
      const _never: never = measurements;
      return _never;
    }
  }
}
