"use client";

import {
  isPropLayout,
  layoutFromMeasurements,
  type Prop,
  type PropLayout,
  type PropMeasurements,
} from "@nightplot/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PropLayoutEditor } from "@/components/props/prop-layout-editor";
import { patchJson } from "@/lib/api";

export function EditProp({ prop }: { prop: Prop }) {
  const router = useRouter();
  const initial = prop.layout && isPropLayout(prop.layout) ? prop.layout : layoutFromDesign(prop);
  const [notice, setNotice] = useState<string | null>(null);
  if (!initial) {
    return (
      <div className="mx-auto max-w-[560px] px-4 py-8">
        <h1 className="text-[26px] font-semibold">{prop.label}</h1>
        <p className="mt-2 text-[15px] text-muted-foreground">This prop has no drawing to edit.</p>
      </div>
    );
  }
  return (
    <>
      {notice ? <p className="px-4 pt-4 text-[15px] text-destructive">{notice}</p> : null}
      <PropLayoutEditor
        name={prop.label}
        initial={initial}
        mode={prop.kind === "custom" ? "trace" : "edit"}
        onBack={() => router.push("/")}
        onDone={(layout) => void save(layout)}
      />
    </>
  );

  async function save(layout: PropLayout) {
    const res = await patchJson(`/api/props/${prop.id}`, {
      layout,
      measurements: prop.design?.measurements ?? { shape: "custom" },
    });
    if (!res.ok) {
      setNotice(res.data.message ?? "The drawing was not saved.");
      return;
    }
    router.push("/");
    router.refresh();
  }
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
