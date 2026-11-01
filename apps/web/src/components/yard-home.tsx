import {
  layoutStrings,
  propAttachmentLabel,
  yardSetupSteps,
  type Light,
  type Prop,
  type PropAttachment,
  type PropKind,
  type YardStep,
} from "@nightplot/shared";
import Link from "next/link";
import { PropShapeArt } from "@/components/props/prop-shape-art";
import { YardStage } from "@/components/yard-stage";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function YardHome({
  props,
  attachments,
  lights,
  looksReady,
  yardClear,
  looksKnown,
  yardKnown,
}: {
  props: Prop[];
  attachments: PropAttachment[];
  lights: Pick<Light, "id" | "name" | "outputs">[];
  looksReady: boolean;
  yardClear: boolean;
  looksKnown: boolean;
  yardKnown: boolean;
}) {
  const unattached = props.filter((prop) => !attachments.some((row) => row.propId === prop.id)).length;
  const steps = yardSetupSteps({
    propCount: props.length,
    unattachedCount: unattached,
    lightCount: lights.length,
    looksReady,
    yardClear,
  });
  const next = steps.find((step) => step.mark === "next");
  const firstLoose = props.find((prop) => !attachments.some((row) => row.propId === prop.id));
  const split = props.length > 0;

  return (
    <div
      data-yard-layout={split ? "split" : "stack"}
      className={cn(
        "mx-auto flex w-full max-w-[720px] flex-1 flex-col gap-6 px-4 py-6 sm:px-8",
        split && "lg:mx-0 lg:grid lg:h-[calc(100dvh-3.5rem)] lg:max-h-[calc(100dvh-3.5rem)] lg:max-w-none lg:min-h-0 lg:flex-none lg:grid-cols-[380px_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)] lg:gap-0 lg:overflow-hidden lg:px-0 lg:py-0",
      )}
    >
      <div className={cn("contents", split && "lg:col-start-1 lg:row-start-1 lg:flex lg:h-full lg:min-h-0 lg:flex-col lg:gap-6 lg:overflow-y-auto lg:border-r lg:border-border lg:px-6 lg:py-6")}>
        <div className="order-1 flex flex-col gap-6 lg:order-none">
          <div className="flex flex-col gap-1">
            <h1 className="text-[26px] font-semibold tracking-[-0.01em]">Your yard</h1>
            <p className="text-[15px] leading-6 text-muted-foreground">
              Design the props first. Controllers can wait.
            </p>
          </div>
          <ol className="flex flex-col gap-2" aria-label="Setup">
            {steps.map((step, index) => (
              <li key={step.id}>
                <StepRow
                  index={index + 1}
                  step={step}
                  href={stepHref(step.id, firstLoose?.id)}
                  note={stepNote(step.id, looksKnown, yardKnown)}
                />
              </li>
            ))}
          </ol>
          {next && next.id !== "design" ? (
            <Button asChild size="lg" className="min-h-12 w-full text-base">
              <Link href={stepHref(next.id, firstLoose?.id)}>{nextAction(next.id)}</Link>
            </Button>
          ) : null}
          <Button asChild size="lg" variant={next?.id === "design" ? "default" : "outline"} className="min-h-12 w-full text-base">
            <Link href="/props/new">New prop</Link>
          </Button>
          {!next ? (
            <p className="text-[15px] text-muted-foreground">The checklist is done. Look at the lights outside to be sure.</p>
          ) : null}
        </div>
        <section className="order-3 flex flex-col gap-3 lg:order-none" aria-label="Props">
        <h2 className="text-[20px] font-semibold">Props</h2>
        {props.length === 0 ? (
          <p className="rounded-[14px] border border-border bg-card px-4 py-5 text-[15px] leading-6 text-muted-foreground">
            No props yet. A prop is a shape — a roofline, a window, an arch — and it does not need a controller.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {props.map((prop) => {
              const attachment = attachments.find((row) => row.propId === prop.id) ?? null;
              const light = attachment ? lights.find((row) => row.id === attachment.lightId) : undefined;
              const output = light?.outputs?.find((row) => row.id === attachment?.outputId);
              const count = prop.design?.ledCount;
              return (
                <li key={prop.id} className="flex gap-3 rounded-[14px] border border-border bg-card p-3">
                  <SectionSketch prop={prop} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[16px] font-medium">{prop.label}</p>
                    <p className="text-[13px] text-muted-foreground">{shapeTitle(prop.kind)}</p>
                    <p className="mt-1 text-[15px]">
                      {count === null || count === undefined ? "Light count unknown" : `${count} lights`}
                    </p>
                    <p className="text-[14px] text-muted-foreground">
                      {!attachment
                        ? "Not attached"
                        : !light
                          ? "Controller missing"
                          : propAttachmentLabel(attachment, light.name, output?.index ?? null)}
                    </p>
                    <span className="mt-3 flex gap-2">
                      <Link href={`/props/${prop.id}/edit`} className="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg border border-border px-3 text-[15px]">
                        Edit
                      </Link>
                      {prop.layout ? (
                        <Link href={`/props/${prop.id}/edit?step=sections`} className="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg border border-border px-3 text-[15px]">
                          Sections
                        </Link>
                      ) : null}
                      {!attachment ? (
                        <Link href={`/props/${prop.id}/attach`} className="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg border border-primary px-3 text-[15px] text-primary">
                          Attach
                        </Link>
                      ) : null}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        </section>
      </div>
      {split ? (
        <div className="order-2 flex min-h-0 min-w-0 flex-col lg:order-none lg:col-start-2 lg:row-start-1 lg:h-full lg:overflow-y-auto lg:p-4">
          <YardStage props={props} />
        </div>
      ) : null}
    </div>
  );
}

function SectionSketch({ prop }: { prop: Prop }) {
  const layout = prop.layout;
  if (!layout || layout.corners.length === 0) return <PropShapeArt kind={prop.kind} />;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const corner of layout.corners) {
    minX = Math.min(minX, corner.x);
    minY = Math.min(minY, corner.y);
    maxX = Math.max(maxX, corner.x);
    maxY = Math.max(maxY, corner.y);
  }
  const span = Math.max(maxX - minX, maxY - minY, layout.pitchM);
  const colourOf = new Map<string, string>();
  for (const section of prop.sections ?? []) {
    for (const id of section.edgeIds) {
      if (!colourOf.has(id) && section.color) colourOf.set(id, section.color);
    }
  }
  return (
    <svg viewBox={`${minX - span * 0.08} ${-(maxY + span * 0.08)} ${maxX - minX + span * 0.16} ${maxY - minY + span * 0.16}`} className="h-16 w-16 shrink-0" aria-hidden>
      {layoutStrings(layout).flatMap((string) => string.run).map((edge) => {
        const from = layout.corners.find((corner) => corner.id === edge.from);
        const to = layout.corners.find((corner) => corner.id === edge.to);
        if (!from || !to || edge.kind === "wire") return null;
        return <line key={edge.id} x1={from.x} y1={-from.y} x2={to.x} y2={-to.y} stroke={colourOf.get(edge.id) ?? "#d4a574"} strokeWidth={span * 0.06} strokeLinecap="round" />;
      })}
    </svg>
  );
}

function StepRow({
  index,
  step,
  href,
  note,
}: {
  index: number;
  step: YardStep;
  href: string;
  note?: string;
}) {
  const mark = step.mark === "done" ? "Done" : step.mark === "next" ? "Next" : "Not yet";
  return (
    <Link
      href={href}
      className={cn(
        "flex min-h-11 items-center gap-3 rounded-xl border px-3 py-2",
        step.mark === "next" ? "border-primary bg-card" : "border-border",
      )}
      aria-current={step.mark === "next" ? "step" : undefined}
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-[13px]">{index}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px]">{step.title}</span>
        {note ? <span className="block text-[13px] text-muted-foreground">{note}</span> : null}
      </span>
      <span className={cn("text-[13px]", step.mark === "next" ? "font-medium text-primary" : "text-muted-foreground")}>{mark}</span>
    </Link>
  );
}

function stepHref(id: YardStep["id"], loosePropId: string | undefined): string {
  switch (id) {
    case "design":
      return "/props/new";
    case "connect":
      return "/discover";
    case "attach":
      return loosePropId ? `/props/${loosePropId}/attach` : "/props/new";
    case "looks":
      return "/looks";
    case "check":
      return "/yard";
    default: {
      const _never: never = id;
      return _never;
    }
  }
}

function nextAction(id: YardStep["id"]): string {
  switch (id) {
    case "design":
      return "New prop";
    case "connect":
      return "Connect controllers";
    case "attach":
      return "Attach a prop";
    case "looks":
      return "Pick looks";
    case "check":
      return "Yard check";
    default: {
      const _never: never = id;
      return _never;
    }
  }
}

function shapeTitle(kind: PropKind): string {
  switch (kind) {
    case "roofline":
      return "Roofline";
    case "window":
      return "Window";
    case "arch":
      return "Arch";
    case "tree":
      return "Mini tree";
    case "stake-row":
      return "Stake row";
    case "wireframe":
      return "Well house";
    case "custom":
      return "Custom draw";
    default: {
      const _never: never = kind;
      return _never;
    }
  }
}

function stepNote(id: YardStep["id"], looksKnown: boolean, yardKnown: boolean): string | undefined {
  if (id === "looks" && !looksKnown) return "Could not read Looks.";
  if (id === "check" && !yardKnown) return "Could not read the yard.";
  return undefined;
}
