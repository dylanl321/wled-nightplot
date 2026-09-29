"use client";

import {
  BLINK_PULSE_MS,
  formatNodeLength,
  PHYSICAL_LENGTH_CAPTION,
  stripBeadCaption,
  type DiscoverRow,
  type LightView,
} from "@nightplot/shared";
import Link from "next/link";
import { useMemo, useState, type MouseEvent } from "react";
import { useDiscoveryCandidates } from "@/components/discovery-watch";
import { StripBeads } from "@/components/strip-beads";
import { Button } from "@/components/ui/button";
import { postJson } from "@/lib/api";
import { displayBead } from "@/lib/power-status";
import { brightnessPct, lastSeenLabel } from "@/lib/time";
import { cn } from "@/lib/utils";

export function LightsHome({
  lights,
  unenrolled,
}: {
  lights: LightView[];
  unenrolled: DiscoverRow[];
}) {
  const discovered = useDiscoveryCandidates();
  const tray = useMemo(() => {
    if (!discovered) return unenrolled;
    const enrolled = new Set(lights.map((light) => light.hostKey));
    return discovered.filter((row) => row.status === "found" && !enrolled.has(row.key));
  }, [discovered, lights, unenrolled]);

  if (lights.length === 0) {
    return (
      <div className="mx-auto flex w-full max-w-[720px] flex-1 flex-col gap-6 px-5 py-8 sm:px-8 sm:py-10">
        <div className="flex flex-col gap-1">
          <h1 className="text-[26px] font-semibold tracking-[-0.01em]">Lights</h1>
          <p className="text-muted-foreground">Nothing on this network has been added yet.</p>
        </div>
        <div className="flex justify-center rounded-[14px] border border-border bg-card px-3.5 py-5">
          <StripBeads
            id="empty"
            count={16}
            color={() => null}
            pitch={18}
            gutter={0}
            top={3}
            bottom={3}
            ariaLabel="Empty strip — no Lights enrolled"
          />
        </div>
        <div className="flex flex-col gap-2.5">
          <h2 className="text-2xl font-semibold tracking-[-0.01em]">No Lights yet</h2>
          <p className="max-w-prose text-[15px] leading-6 text-[#c9c3b8]">
            Nightplot finds WLED controllers on your home network. Nothing changes
            on any strip until you add one. Segments — contiguous ranges on a
            Light — appear after that.
          </p>
        </div>
        <div className="flex flex-col gap-2.5 sm:flex-row">
          <Button asChild size="lg" className="sm:min-w-[160px]">
            <Link href="/discover">Find Lights</Link>
          </Button>
          <Button asChild variant="outline" size="lg" className="sm:min-w-[160px]">
            <Link href="/discover#address">Type an address</Link>
          </Button>
          <Button asChild variant="outline" size="lg" className="sm:min-w-[160px]">
            <Link href="/led-products">LED products</Link>
          </Button>
        </div>
        <FoundBanner rows={tray} />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[1040px] flex-1 flex-col gap-4 px-6 py-6 sm:px-10">
      <div className="flex items-center gap-4">
        <h1 className="text-[28px] font-semibold tracking-[-0.01em]">Lights</h1>
        <Button asChild className="ml-auto">
          <Link href="/discover">Add a Light</Link>
        </Button>
      </div>
      {lights.map((light) => (
        <LightCard key={light.id} light={light} />
      ))}
      <FoundBanner rows={tray} />
    </div>
  );
}

function LightCard({ light }: { light: LightView }) {
  const unreachable = light.reachability === "no-answer";
  const bead = displayBead(light);
  const status = cardStatus(light);
  const drifted = light.declared.filter((span) => span.differs);
  const length = formatNodeLength(light.ledCount, light.spacingMm);
  const [blinkBusy, setBlinkBusy] = useState(false);
  const [blinkNotice, setBlinkNotice] = useState<string | null>(null);

  async function blink(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (unreachable || blinkBusy) return;
    setBlinkBusy(true);
    setBlinkNotice(null);
    try {
      const started = await postJson(`/api/lights/${light.id}/blink`, {});
      if (started.ok) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, BLINK_PULSE_MS));
        const ended = await postJson(`/api/lights/${light.id}/blink/end`, {});
        if (!ended.ok) setBlinkNotice(ended.data.message ?? "Blink could not restore this Light.");
      } else {
        setBlinkNotice(started.data.message ?? "Blink did not run.");
      }
    } catch {
      setBlinkNotice("Blink could not reach the Light. Refresh to check its state.");
    } finally {
      setBlinkBusy(false);
    }
  }

  return (
    <article
      id={`light-${light.id}`}
      className="relative flex flex-col gap-3.5 rounded-[14px] border border-border bg-card px-5 pt-[18px] pb-4"
    >
      <Link
        href={`/lights/${light.id}`}
        className="absolute inset-0 rounded-[14px]"
        aria-label={`Open ${light.name}`}
      />
      <div className="pointer-events-none flex items-center gap-3">
        <span className="text-[18px] font-medium">{light.name}</span>
        <span className={cn("inline-flex items-center gap-1.5 text-[13px]", status.className)}>
          <span className="size-1.5 rounded-full" style={{ background: status.dot }} />
          {status.label}
        </span>
        <Button
          type="button"
          variant="outline"
          className={cn("pointer-events-auto relative z-10 ml-auto h-8", unreachable && "opacity-40")}
          disabled={unreachable || blinkBusy}
          onClick={(event) => void blink(event)}
        >
          Blink
        </Button>
      </div>
      {blinkNotice ? <p className="pointer-events-none text-[13px] text-destructive">{blinkNotice}</p> : null}
      <div className="pointer-events-none overflow-x-auto">
        <StripBeads
          id={`rack-${light.id}`}
          count={Math.max(light.ledCount, 1)}
          perRow={150}
          pitch={6.5}
          gutter={0}
          top={28}
          bottom={6}
          fontSize={11}
          color={() => bead}
          brightness={unreachable ? 1 : 0.85}
          rgbw={light.stripBead === "rgbw"}
          declared={light.declared.map((span) => ({
            start: span.start,
            stop: span.stop,
            label: span.label,
            differs: span.differs,
          }))}
          ariaLabel={`${light.name} strip, ${stripBeadCaption(light.stripBead)}`}
        />
      </div>
      <div className="pointer-events-none flex flex-wrap items-center gap-2 text-[13px]">
        <span className="text-muted-foreground">
          {light.ledCount} LEDs
          {length ? ` · ${length}` : ""} · {light.stripChip} · {light.displayHost}
        </span>
        {length ? <span className="text-quiet">{PHYSICAL_LENGTH_CAPTION}</span> : null}
        <span className="ml-auto">
          <CardSync light={light} drifted={drifted.length} />
        </span>
      </div>
    </article>
  );
}

function CardSync({ light, drifted }: { light: LightView; drifted: number }) {
  if (light.reachability === "no-answer") {
    return (
      <span className="text-destructive" suppressHydrationWarning>
        {lastSeenLabel(light.lastSeenAt)} · shown grey, not its last colour
      </span>
    );
  }
  if (light.segmentCount == null) {
    return <span className="text-muted-foreground">Segments unknown</span>;
  }
  if (light.segmentCount === 0) {
    return <span className="text-muted-foreground">0 segments</span>;
  }
  if (drifted > 0) {
    return (
      <span className="text-primary">
        {drifted} Segment{drifted === 1 ? "" : "s"} don’t match the controller · Review
      </span>
    );
  }
  if (light.driftLabel) {
    return <span className="text-primary">{light.driftLabel} · Review</span>;
  }
  return <span className="text-muted-foreground">In sync with the controller</span>;
}

function cardStatus(light: LightView): { label: string; className: string; dot: string } {
  if (light.reachability === "no-answer") {
    return { label: "Not answering", className: "text-destructive", dot: "#e07070" };
  }
  if (light.on === true) {
    const pct = brightnessPct(light.brightness);
    return {
      label: pct !== null ? `On · ${pct}%` : "On",
      className: "text-online",
      dot: "#7ee0d0",
    };
  }
  if (light.on === false) {
    return { label: "Off", className: "text-[#c9c3b8]", dot: "#3e3c37" };
  }
  return { label: "Power unknown", className: "text-[#c9c3b8]", dot: "#3e3c37" };
}

function FoundBanner({ rows }: { rows: DiscoverRow[] }) {
  const [busyHost, setBusyHost] = useState<string | null>(null);
  if (rows.length === 0) return null;

  async function blink(host: string) {
    setBusyHost(host);
    await postJson("/api/discover/blink", { host });
    setBusyHost(null);
  }

  const noun =
    rows.length === 1
      ? "Found 1 controller that isn’t added"
      : `Found ${rows.length} controllers that aren’t added`;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-dashed border-[#3a4150] px-4 py-3">
      <div className="flex items-center gap-3.5">
        <span className="size-2 rounded-full bg-primary" />
        <span>{noun}</span>
      </div>
      {rows.map((row) => (
        <div key={row.key} className="flex flex-wrap items-center gap-3.5">
          <span className="font-mono text-[13px] text-muted-foreground">
            WLED · {row.displayHost}
          </span>
          <Button asChild variant="outline" className="h-8">
            <Link href="/discover">Add</Link>
          </Button>
          <button
            type="button"
            className="text-[13px] text-foreground"
            disabled={busyHost === row.displayHost}
            onClick={() => void blink(row.displayHost)}
          >
            Blink it
          </button>
          {row.portWarning ? (
            <span className="basis-full text-xs text-primary">{row.portWarning}</span>
          ) : null}
        </div>
      ))}
    </div>
  );
}
