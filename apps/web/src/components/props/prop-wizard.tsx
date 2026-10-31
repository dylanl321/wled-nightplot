"use client";

import {
  compilePropDesign,
  DEFAULT_PITCH_MM,
  emptyTrace,
  METRES_PER_FOOT,
  rooflineLayout,
  windowLayout,
  type PropKind,
  type PropLayout,
  type PropLengthUnit,
  type PropMeasurements,
} from "@nightplot/shared";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { PropLayoutEditor } from "@/components/props/prop-layout-editor";
import { PropShapeArt } from "@/components/props/prop-shape-art";
import { Button } from "@/components/ui/button";
import { postJson } from "@/lib/api";
import { cn } from "@/lib/utils";

type Step = "name" | "shape" | "size" | "review" | "origin" | "draw";

const SHAPES: { kind: PropKind; title: string; blurb: string }[] = [
  { kind: "roofline", title: "Roofline", blurb: "One line along the roof" },
  { kind: "window", title: "Window", blurb: "A box around a window" },
  { kind: "arch", title: "Arch", blurb: "A curve between two bases" },
  { kind: "tree", title: "Mini tree", blurb: "A cone" },
  { kind: "stake-row", title: "Stake row", blurb: "Uprights in a row" },
  { kind: "wireframe", title: "Well house", blurb: "Box and X on each side" },
  { kind: "custom", title: "Draw it", blurb: "Your own line" },
];

export type SpacingChoice = { id: string; name: string; pitchMm: number };

export function PropWizard({ products }: { products: SpacingChoice[] }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("name");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<PropKind | null>(null);
  const [unit, setUnit] = useState<PropLengthUnit>("ft");
  const [spacingCm, setSpacingCm] = useState("10");
  const [productId, setProductId] = useState<string | null>(null);
  const [length, setLength] = useState("40");
  const [width, setWidth] = useState("4");
  const [height, setHeight] = useState("3");
  const [base, setBase] = useState("3");
  const [stakes, setStakes] = useState("8");
  const [sides, setSides] = useState("8");
  const [side, setSide] = useState("4");
  const [postHeight, setPostHeight] = useState("4");
  const [postTouched, setPostTouched] = useState(false);
  const [startCorner, setStartCorner] = useState<0 | 1 | 2 | 3>(0);
  const [clockwise, setClockwise] = useState(true);
  const [startAtFarEnd, setStartAtFarEnd] = useState(false);
  const [drawLayout, setDrawLayout] = useState<PropLayout | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pitchMm = Number(spacingCm) * 10;
  const measurements = useMemo(() => buildMeasurements({
    kind, length, width, height, base, stakes, sides, side, postHeight,
  }), [kind, length, width, height, base, stakes, sides, side, postHeight]);

  const compiled = kind && kind !== "custom" && measurements
    ? compilePropDesign({
      kind,
      unit,
      pitchMm: Number.isFinite(pitchMm) && pitchMm > 0 ? pitchMm : DEFAULT_PITCH_MM,
      ledProductId: productId,
      measurements,
    })
    : null;

  function back() {
    setNotice(null);
    if (step === "shape") setStep("name");
    else if (step === "size" || step === "origin") setStep(step === "origin" ? "size" : "shape");
    else if (step === "review") setStep("size");
  }

  function next() {
    setNotice(null);
    if (step === "name") {
      if (!name.trim()) {
        setNotice("Give this prop a name.");
        return;
      }
      setStep("shape");
      return;
    }
    if (step === "shape") {
      if (!kind) {
        setNotice("Pick a shape.");
        return;
      }
      if (kind === "custom") {
        setDrawLayout(emptyTrace(unit, (Number.isFinite(pitchMm) && pitchMm > 0 ? pitchMm : DEFAULT_PITCH_MM) / 1000));
        setStep("draw");
        return;
      }
      setStep("size");
      return;
    }
    if (step === "size") {
      if (!compiled || !compiled.ok) {
        setNotice(compiled && !compiled.ok ? compiled.message : "Check the measurements.");
        return;
      }
      setStep(kind === "window" || kind === "roofline" ? "origin" : "review");
    }
  }

  function drawing(): PropLayout {
    const pitchM = (Number.isFinite(pitchMm) && pitchMm > 0 ? pitchMm : DEFAULT_PITCH_MM) / 1000;
    const toM = (value: string) => Number(value) * (unit === "ft" ? METRES_PER_FOOT : 1);
    if (kind === "window") {
      return windowLayout({
        widthM: toM(width),
        heightM: toM(height),
        units: unit,
        pitchM,
        startCorner,
        clockwise,
        params: { width: Number(width), height: Number(height) },
      });
    }
    if (kind === "roofline") {
      return rooflineLayout({
        lengthM: toM(length),
        units: unit,
        pitchM,
        startAtFarEnd,
        params: { length: Number(length) },
      });
    }
    return emptyTrace(unit, pitchM);
  }

  async function saveLayout(layout: PropLayout) {
    if (!kind) return;
    setBusy(true);
    setNotice(null);
    const res = await postJson<{ message?: string }>("/api/props", {
      label: name.trim(),
      kind,
      unit,
      pitchMm: Number.isFinite(pitchMm) && pitchMm > 0 ? pitchMm : DEFAULT_PITCH_MM,
      ledProductId: productId,
      measurements: kind === "custom" ? { shape: "custom" } : measurements,
      layout,
    });
    setBusy(false);
    if (!res.ok) {
      setNotice(res.data.message ?? "The prop was not saved.");
      return;
    }
    router.push("/");
    router.refresh();
  }

  async function save() {
    if (!kind || !measurements || !compiled || !compiled.ok) return;
    setBusy(true);
    setNotice(null);
    const res = await postJson<{ prop: { id: string }; message?: string }>("/api/props", {
      label: name.trim(),
      kind,
      unit,
      pitchMm,
      ledProductId: productId,
      measurements,
    });
    setBusy(false);
    if (!res.ok) {
      setNotice(res.data.message ?? "The prop was not saved.");
      return;
    }
    router.push("/");
    router.refresh();
  }

  if (step === "draw") {
    return (
      <PropLayoutEditor
        name={name.trim() || "New prop"}
        initial={drawLayout ?? emptyTrace(unit)}
        mode={kind === "custom" ? "trace" : "edit"}
        onBack={() => setStep(kind === "custom" ? "shape" : "origin")}
        onDone={(layout) => void saveLayout(layout)}
      />
    );
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-1 px-1">
        <button type="button" className="min-h-11 px-3 text-[16px]" onClick={step === "name" ? () => router.push("/") : back}>Back</button>
        <p className="min-w-0 flex-1 truncate text-[17px] font-medium">{name.trim() || "New prop"}</p>
      </header>
      <div className="flex flex-1 flex-col gap-5 px-4 pb-28">
      <h1 className="text-[26px] font-semibold tracking-[-0.01em]">{stepTitle(step)}</h1>
      {step === "name" ? (
        <label className="flex flex-col gap-2 text-[15px]">
          Name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="min-h-11 w-full rounded-md border border-input bg-[#07080a] px-3 text-base text-foreground outline-none focus:border-primary"
            autoComplete="off"
          />
        </label>
      ) : null}
      {step === "shape" ? (
        <div className="grid grid-cols-2 gap-2">
          {SHAPES.map((shape) => (
            <button
              key={shape.kind}
              type="button"
              onClick={() => setKind(shape.kind)}
              className={cn(
                "flex min-h-[104px] scroll-mb-36 flex-col items-start gap-1 rounded-xl border p-3 text-left",
                kind === shape.kind ? "border-primary bg-card" : "border-border",
              )}
            >
              <PropShapeArt kind={shape.kind} />
              <span className="text-[15px] font-medium">{shape.title}</span>
              <span className="text-[13px] text-muted-foreground">{shape.blurb}</span>
            </button>
          ))}
        </div>
      ) : null}
      {step === "origin" && kind === "window" ? (
        <div className="flex flex-col gap-3">
          <p className="text-[15px] leading-6">Tap the corner where the controller end of the string starts, then choose the direction.</p>
          <div className="grid grid-cols-2 gap-2">
            {(["Bottom left", "Bottom right", "Top right", "Top left"] as const).map((label, index) => (
              <button
                key={label}
                type="button"
                className={`min-h-[72px] rounded-xl border p-3 text-left text-[15px] ${startCorner === index ? "border-primary bg-card" : "border-border"}`}
                onClick={() => setStartCorner(index as 0 | 1 | 2 | 3)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button type="button" className={`min-h-11 flex-1 rounded-lg border text-base ${clockwise ? "border-primary" : "border-border"}`} onClick={() => setClockwise(true)}>Clockwise</button>
            <button type="button" className={`min-h-11 flex-1 rounded-lg border text-base ${!clockwise ? "border-primary" : "border-border"}`} onClick={() => setClockwise(false)}>Counter-clockwise</button>
          </div>
        </div>
      ) : null}
      {step === "origin" && kind === "roofline" ? (
        <div className="flex flex-col gap-3">
          <p className="text-[15px] leading-6">Which end is the controller end?</p>
          <button type="button" className={`min-h-11 rounded-lg border text-base ${!startAtFarEnd ? "border-primary" : "border-border"}`} onClick={() => setStartAtFarEnd(false)}>This end</button>
          <button type="button" className={`min-h-11 rounded-lg border text-base ${startAtFarEnd ? "border-primary" : "border-border"}`} onClick={() => setStartAtFarEnd(true)}>The far end</button>
        </div>
      ) : null}
      {step === "size" && kind && kind !== "custom" ? (
        <div className="flex flex-col gap-4">
          <div className="flex gap-2">
            <UnitButton active={unit === "ft"} onClick={() => setUnit("ft")}>Feet</UnitButton>
            <UnitButton active={unit === "m"} onClick={() => setUnit("m")}>Metres</UnitButton>
          </div>
          <SizeFields
            kind={kind}
            unit={unit}
            length={length}
            width={width}
            height={height}
            base={base}
            stakes={stakes}
            sides={sides}
            side={side}
            postHeight={postHeight}
            onLength={setLength}
            onWidth={setWidth}
            onHeight={setHeight}
            onBase={setBase}
            onStakes={setStakes}
            onSides={setSides}
            onSide={(value) => {
              setSide(value);
              if (!postTouched) setPostHeight(value);
            }}
            onPostHeight={(value) => {
              setPostTouched(true);
              setPostHeight(value);
            }}
          />
          <label className="flex flex-col gap-2 text-[15px]">
            Light spacing (cm)
            <input
              inputMode="decimal"
              value={spacingCm}
              onChange={(event) => {
                setSpacingCm(event.target.value);
                setProductId(null);
              }}
              className="min-h-11 w-full rounded-md border border-input bg-[#07080a] px-3 text-base text-foreground outline-none focus:border-primary"
            />
          </label>
          <label className="flex flex-col gap-2 text-[15px]">
            LED product
            <select
              value={productId ?? ""}
              onChange={(event) => {
                const id = event.target.value;
                if (!id) {
                  setProductId(null);
                  setSpacingCm("10");
                  return;
                }
                const product = products.find((row) => row.id === id);
                setProductId(id);
                if (product) setSpacingCm(String(Math.round((product.pitchMm / 10) * 100) / 100));
              }}
              className="min-h-11 w-full rounded-md border border-input bg-[#07080a] px-3 text-base text-foreground"
            >
              <option value="">10 cm</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>{product.name}</option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
      {step === "review" && compiled?.ok ? (
        <div className="flex flex-col gap-4">
          {kind ? <PropShapeArt kind={kind} /> : null}
          <p className="text-[22px] font-semibold">{compiled.design.ledCount} lights</p>
          <p className="text-[15px] text-muted-foreground">{name.trim()} · {spacingCm} cm spacing</p>
          <ul className="flex flex-col gap-1">
            {compiled.design.edges.map((edge) => (
              <li key={edge.id} className="flex justify-between gap-3 text-[15px]">
                <span className="min-w-0 truncate">{edge.label}</span>
                <span className="shrink-0 text-muted-foreground">{edge.ledCount}</span>
              </li>
            ))}
          </ul>
          <p className="text-[14px] leading-5 text-muted-foreground">
            Saved in Nightplot only. No controller is contacted.
          </p>
        </div>
      ) : null}
      {notice ? <p className="text-[15px] text-destructive">{notice}</p> : null}
      </div>
      <div
        className="fixed inset-x-0 bottom-0 z-20 mx-auto flex w-full max-w-[560px] gap-2 border-t border-border bg-background px-4 py-3"
        style={{ paddingLeft: "max(1rem, env(safe-area-inset-left))", paddingRight: "max(1rem, env(safe-area-inset-right))" }}
      >
        <Button type="button" variant="outline" className="min-h-11 flex-1 text-base" onClick={back} disabled={step === "name" || busy}>
          Back
        </Button>
        {step === "origin" ? (
          <Button type="button" className="min-h-11 flex-1 text-base" onClick={() => { setDrawLayout(drawing()); setStep("draw"); }}>Next</Button>
        ) : step === "review" ? (
          <Button type="button" className="min-h-11 flex-1 text-base" onClick={() => void save()} disabled={busy || !compiled?.ok}>
            {busy ? "Saving…" : "Save"}
          </Button>
        ) : (
          <Button type="button" className="min-h-11 flex-1 text-base" onClick={next} disabled={busy}>
            Next
          </Button>
        )}
      </div>
    </div>
  );
}

function UnitButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "min-h-11 flex-1 rounded-lg border text-base",
        active ? "border-primary bg-card font-medium" : "border-border text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="flex flex-col gap-2 text-[15px]">
      {label}
      <input
        inputMode="decimal"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-11 w-full rounded-md border border-input bg-[#07080a] px-3 text-base text-foreground outline-none focus:border-primary"
      />
    </label>
  );
}

function SizeFields(props: {
  kind: PropKind;
  unit: PropLengthUnit;
  length: string;
  width: string;
  height: string;
  base: string;
  stakes: string;
  sides: string;
  side: string;
  postHeight: string;
  onLength: (value: string) => void;
  onWidth: (value: string) => void;
  onHeight: (value: string) => void;
  onBase: (value: string) => void;
  onStakes: (value: string) => void;
  onSides: (value: string) => void;
  onSide: (value: string) => void;
  onPostHeight: (value: string) => void;
}) {
  const unit = props.unit === "ft" ? "ft" : "m";
  switch (props.kind) {
    case "roofline":
      return <Field label={`Length (${unit})`} value={props.length} onChange={props.onLength} />;
    case "window":
    case "arch":
      return (
        <>
          <Field label={`Width (${unit})`} value={props.width} onChange={props.onWidth} />
          <Field label={`Height (${unit})`} value={props.height} onChange={props.onHeight} />
        </>
      );
    case "tree":
      return (
        <>
          <Field label={`Height (${unit})`} value={props.height} onChange={props.onHeight} />
          <Field label={`Base width (${unit})`} value={props.base} onChange={props.onBase} />
        </>
      );
    case "stake-row":
      return (
        <>
          <Field label="How many stakes" value={props.stakes} onChange={props.onStakes} />
          <Field label={`Height of each (${unit})`} value={props.height} onChange={props.onHeight} />
        </>
      );
    case "wireframe":
      return (
        <>
          <Field label="Sides" value={props.sides} onChange={props.onSides} />
          <Field label={`Side length (${unit})`} value={props.side} onChange={props.onSide} />
          <Field label={`Height (${unit})`} value={props.postHeight} onChange={props.onPostHeight} />
        </>
      );
    case "custom":
      return null;
    default: {
      const _never: never = props.kind;
      return _never;
    }
  }
}

function buildMeasurements(input: {
  kind: PropKind | null;
  length: string;
  width: string;
  height: string;
  base: string;
  stakes: string;
  sides: string;
  side: string;
  postHeight: string;
}): PropMeasurements | null {
  const num = (value: string) => Number(value);
  switch (input.kind) {
    case "roofline":
      return { shape: "roofline", length: num(input.length) };
    case "window":
      return { shape: "window", width: num(input.width), height: num(input.height) };
    case "arch":
      return { shape: "arch", width: num(input.width), height: num(input.height) };
    case "tree":
      return { shape: "tree", height: num(input.height), base: num(input.base) };
    case "stake-row":
      return { shape: "stake-row", stakes: num(input.stakes), height: num(input.height) };
    case "wireframe":
      return { shape: "wireframe", sides: num(input.sides), side: num(input.side), height: num(input.postHeight) };
    case "custom":
      return { shape: "custom" };
    case null:
      return null;
    default: {
      const _never: never = input.kind;
      return _never;
    }
  }
}

function stepTitle(step: Step): string {
  switch (step) {
    case "name":
      return "What should this prop be called?";
    case "shape":
      return "What shape is it?";
    case "size":
      return "How big is it?";
    case "review":
      return "Here is the prop";
    case "origin":
      return "Which corner is the controller end?";
    case "draw":
      return "Draw the prop";
    default: {
      const _never: never = step;
      return _never;
    }
  }
}
