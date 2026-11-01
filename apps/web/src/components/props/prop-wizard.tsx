"use client";

import {
  compilePropDesign,
  convertSize,
  defaultSections,
  DEFAULT_PITCH_MM,
  emptyTrace,
  METRES_PER_FOOT,
  rooflineLayout,
  windowLayout,
  type PropKind,
  type PropLayout,
  type PropLengthUnit,
  type PropMeasurements,
  type PropSection,
} from "@nightplot/shared";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { PropLayoutEditor } from "@/components/props/prop-layout-editor";
import { PropSectionsStep } from "@/components/props/prop-sections";
import { PropShapeArt } from "@/components/props/prop-shape-art";
import { Button } from "@/components/ui/button";
import { postJson } from "@/lib/api";
import { cn } from "@/lib/utils";

type Step = "name" | "shape" | "size" | "review" | "origin" | "draw" | "sections";

const SHAPES: { kind: PropKind; title: string; blurb: string }[] = [
  { kind: "roofline", title: "Roofline", blurb: "One line along the roof" },
  { kind: "window", title: "Window", blurb: "A box around a window" },
  { kind: "arch", title: "Arch", blurb: "A curve between two bases" },
  { kind: "tree", title: "Mini tree", blurb: "A cone" },
  { kind: "stake-row", title: "Stake row", blurb: "Uprights in a row" },
  { kind: "wireframe", title: "Well house", blurb: "One string around the walls" },
  { kind: "custom", title: "Draw it", blurb: "Your own line" },
];

export type SpacingChoice = { id: string; name: string; pitchMm: number };

export function PropWizard({ products: _products }: { products: SpacingChoice[] }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("name");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<PropKind | null>(null);
  // Start in the unit used last time. The size fields are not on the first
  // step, so reading this browser's choice here cannot change the server render.
  const [start] = useState(() => (readLastUnit() === "m" ? METRIC_START : IMPERIAL_START));
  const [unit, setUnit] = useState<PropLengthUnit>(start.unit);
  const [spacingCm, setSpacingCm] = useState("10");
  const [productId, setProductId] = useState<string | null>(null);
  const [length, setLength] = useState(start.length);
  const [width, setWidth] = useState(start.width);
  const [height, setHeight] = useState(start.height);
  const [base, setBase] = useState(start.base);
  const [stakes, setStakes] = useState("8");
  const [sides, setSides] = useState("4");
  const [side, setSide] = useState(start.side);
  const [postHeight, setPostHeight] = useState(start.side);
  const [postTouched, setPostTouched] = useState(false);
  const [startCorner, setStartCorner] = useState<0 | 1 | 2 | 3>(0);
  const [clockwise, setClockwise] = useState(true);
  const [startAtFarEnd, setStartAtFarEnd] = useState(false);
  const [drawLayout, setDrawLayout] = useState<PropLayout | null>(null);
  const [sectionLayout, setSectionLayout] = useState<PropLayout | null>(null);
  const [sections, setSections] = useState<PropSection[]>([]);
  const [sectionBack, setSectionBack] = useState<Step>("size");
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Switching units converts every size, the same way spacing is converted. */
  function switchUnit(next: PropLengthUnit) {
    if (next === unit) return;
    const factor = next === "m" ? METRES_PER_FOOT : 1 / METRES_PER_FOOT;
    const convert = (value: string) => convertSize(value, factor, next === "m" ? 3 : 2);
    setLength(convert);
    setWidth(convert);
    setHeight(convert);
    setBase(convert);
    setSide(convert);
    setPostHeight(convert);
    setUnit(next);
    writeLastUnit(next);
  }

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
    else if (step === "sections") {
      if (sectionBack === "draw" && sectionLayout) setDrawLayout(sectionLayout);
      setStep(sectionBack);
    }
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
      if (kind === "window" || kind === "roofline") {
        setStep("origin");
        return;
      }
      if (kind === "wireframe" && compiled.ok) {
        setDrawLayout(compiled.layout);
        setStep("draw");
        return;
      }
      if (compiled.ok) openSections(compiled.layout, "size");
    }
  }

  function openSections(layout: PropLayout, backTo: Step) {
    setSectionLayout(layout);
    setSections(defaultSections(layout));
    setSectionBack(backTo);
    setRangeError(null);
    setStep("sections");
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

  async function saveSections() {
    if (!kind || !sectionLayout || rangeError) return;
    setBusy(true);
    setNotice(null);
    const res = await postJson<{ message?: string }>("/api/props", {
      label: name.trim(),
      kind,
      unit,
      pitchMm: Number.isFinite(pitchMm) && pitchMm > 0 ? pitchMm : DEFAULT_PITCH_MM,
      ledProductId: productId,
      measurements: measurements ?? { shape: "custom" },
      layout: sectionLayout,
      sections,
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
        doneLabel="Name sections"
        onBack={(layout) => {
          setDrawLayout(layout);
          setStep(kind === "custom" ? "shape" : kind === "wireframe" ? "size" : "origin");
        }}
        onDone={(layout) => openSections(layout, "draw")}
      />
    );
  }

  return (
    <div className={`mx-auto flex min-h-dvh w-full max-w-[560px] flex-1 flex-col overflow-x-hidden ${step === "sections" ? "lg:max-w-[1200px]" : ""}`}>
      <header className="flex h-14 shrink-0 items-center gap-1 px-1">
        <button type="button" className="min-h-11 px-3 text-[16px]" onClick={step === "name" ? () => router.push("/") : back}>Back</button>
        <p className="min-w-0 flex-1 truncate text-[17px] font-medium">{name.trim() || "New prop"}</p>
      </header>
      <div className="flex flex-1 flex-col gap-5 px-4 pb-36">
      <h1 className="text-[26px] font-semibold tracking-[-0.01em]">{stepTitle(step, kind)}</h1>
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
            {([
              { index: 3 as const, label: "Top left" },
              { index: 2 as const, label: "Top right" },
              { index: 0 as const, label: "Bottom left" },
              { index: 1 as const, label: "Bottom right" },
            ]).map((corner) => (
              <button
                key={corner.label}
                type="button"
                className={`min-h-[72px] rounded-xl border p-3 text-left text-[15px] ${startCorner === corner.index ? "border-primary bg-card" : "border-border"}`}
                onClick={() => setStartCorner(corner.index)}
              >
                {corner.label}
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
          <p className="text-[15px] leading-6">The controller plugs in at one end of the roof.</p>
          <button type="button" className={`min-h-11 rounded-lg border text-base ${!startAtFarEnd ? "border-primary" : "border-border"}`} onClick={() => setStartAtFarEnd(false)}>This end</button>
          <button type="button" className={`min-h-11 rounded-lg border text-base ${startAtFarEnd ? "border-primary" : "border-border"}`} onClick={() => setStartAtFarEnd(true)}>The far end</button>
        </div>
      ) : null}
      {step === "size" && kind && kind !== "custom" ? (
        <div className="flex flex-col gap-4">
          <div className="flex gap-2">
            <UnitButton active={unit === "ft"} onClick={() => switchUnit("ft")}>Feet</UnitButton>
            <UnitButton active={unit === "m"} onClick={() => switchUnit("m")}>Metres</UnitButton>
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
            {unit === "ft" ? "Light spacing (inches)" : "Light spacing (cm)"}
            <input
              inputMode="decimal"
              value={spacingField(spacingCm, unit)}
              onChange={(event) => {
                setSpacingCm(spacingFromField(event.target.value, unit, spacingCm));
                setProductId(null);
              }}
              className="min-h-11 w-full rounded-md border border-input bg-[#07080a] px-3 text-base text-foreground outline-none focus:border-primary"
            />
          </label>
        </div>
      ) : null}
      {step === "sections" && sectionLayout ? (
        <PropSectionsStep
          layout={sectionLayout}
          sections={sections}
          measurements={measurements ?? { shape: "custom" }}
          onLayout={setSectionLayout}
          onSections={setSections}
          onInvalid={setRangeError}
        />
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
        className={`fixed inset-x-0 bottom-0 z-20 mx-auto flex w-full max-w-[560px] gap-2 border-t border-border bg-background px-4 py-3 ${step === "sections" ? "lg:max-w-[1200px]" : ""}`}
        style={{ paddingLeft: "max(1rem, env(safe-area-inset-left))", paddingRight: "max(1rem, env(safe-area-inset-right))" }}
      >
        <Button type="button" variant="outline" className="min-h-11 flex-1 text-base" onClick={back} disabled={step === "name" || busy}>
          Back
        </Button>
        {step === "origin" ? (
          <Button type="button" className="min-h-11 flex-1 text-base" onClick={() => { setDrawLayout(drawing()); setStep("draw"); }}>Next</Button>
        ) : step === "sections" ? (
          <Button type="button" className="min-h-11 flex-1 text-base" onClick={() => void saveSections()} disabled={busy || Boolean(rangeError) || !sectionLayout}>
            {busy ? "Saving…" : "Save"}
          </Button>
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

const UNIT_KEY = "nightplot.propUnit";

const IMPERIAL_START = { unit: "ft" as PropLengthUnit, length: "40", width: "4", height: "3", base: "3", side: "4" };
/** Round metric sizes, not 3 ft read as 0.914 m. */
const METRIC_START = { unit: "m" as PropLengthUnit, length: "12", width: "1.2", height: "1", base: "1", side: "1.2" };

function readLastUnit(): PropLengthUnit | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(UNIT_KEY);
    return value === "m" || value === "ft" ? value : null;
  } catch {
    return null;
  }
}

function writeLastUnit(unit: PropLengthUnit) {
  try {
    window.localStorage.setItem(UNIT_KEY, unit);
  } catch {
    /* A private window may refuse storage. The unit still switches. */
  }
}

function spacingField(cm: string, unit: PropLengthUnit): string {
  if (unit !== "ft") return cm;
  const n = Number(cm);
  if (!Number.isFinite(n)) return cm;
  return String(Math.round((n / 2.54) * 100) / 100);
}

function spacingFromField(value: string, unit: PropLengthUnit, previousCm: string): string {
  if (unit !== "ft") return value;
  const inches = Number(value);
  if (!Number.isFinite(inches)) return previousCm;
  return String(inches * 2.54);
}

function stepTitle(step: Step, kind: PropKind | null): string {
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
      return kind === "roofline" ? "Which end is the controller end?" : "Which corner is the controller end?";
    case "draw":
      return "Draw the prop";
    case "sections":
      return "Name the sections";
    default: {
      const _never: never = step;
      return _never;
    }
  }
}
