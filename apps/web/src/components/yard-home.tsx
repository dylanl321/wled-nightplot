import {
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

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-1 flex-col gap-6 px-4 py-6 sm:px-8">
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
      {next ? (
        <Button asChild size="lg" className="min-h-12 w-full text-base">
          <Link href={next.id === "design" ? "/props/new" : stepHref(next.id, firstLoose?.id)}>{nextAction(next.id)}</Link>
        </Button>
      ) : (
        <p className="text-[15px] text-muted-foreground">The checklist is done. This is not Hardware Done until you look at the yard.</p>
      )}
      <section className="flex flex-col gap-3" aria-label="Props">
        <div className="flex items-center gap-3">
          <h2 className="text-[20px] font-semibold">Props</h2>
          <Button asChild className="ml-auto min-h-11">
            <Link href="/props/new">New prop</Link>
          </Button>
        </div>
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
                  <PropShapeArt kind={prop.kind} />
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
                    {!attachment ? (
                      <Link href={`/props/${prop.id}/attach`} className="mt-2 inline-flex min-h-11 items-center text-[15px] text-primary">
                        Attach
                      </Link>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
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
