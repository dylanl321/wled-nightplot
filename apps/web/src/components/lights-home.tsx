import { stripBeadCaption, type DiscoverRow, type LightView } from "@nightplot/shared";
import Link from "next/link";
import { MiniStrip } from "@/components/mini-strip";
import { StripBeads } from "@/components/strip-beads";
import { Button } from "@/components/ui/button";
import { displayBead, lightPowerStatus } from "@/lib/power-status";

export function LightsHome({
  lights,
  unenrolled,
}: {
  lights: LightView[];
  unenrolled: DiscoverRow[];
}) {
  if (lights.length === 0) {
    return (
      <div className="mx-auto flex w-full max-w-[720px] flex-1 flex-col gap-6 px-5 py-8 sm:px-8 sm:py-10">
        <Header
          title="Lights"
          subtitle="Nothing on this network has been added yet."
        />
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
            on any strip until you add one. Elements — contiguous ranges on a
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
        <UnenrolledTray rows={unenrolled} />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[920px] flex-1 flex-col gap-4 px-5 py-8 sm:px-8">
      <Header
        title="Lights"
        subtitle={
          lights.length === 1
            ? "One strip on this network. It shows what it last reported."
            : `${lights.length} strips on this network. Each shows what it last reported.`
        }
      />
      {lights.map((light) => (
        <LightRow key={light.id} light={light} />
      ))}
      <UnenrolledTray rows={unenrolled} />
    </div>
  );
}

function Header({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-[26px] font-semibold tracking-[-0.01em]">{title}</h1>
        <p className="text-muted-foreground">{subtitle}</p>
      </div>
      <div className="mt-3 flex flex-col gap-2 sm:ml-auto sm:mt-0 sm:flex-row">
        <Button asChild variant="outline">
          <Link href="/led-products">LED products</Link>
        </Button>
        <Button asChild>
          <Link href="/discover">Find Lights</Link>
        </Button>
      </div>
    </div>
  );
}

function LightRow({ light }: { light: LightView }) {
  const unreachable = light.reachability === "no-answer";
  const bead = displayBead(light);
  const status = lightPowerStatus(light);
  const elementLine =
    light.elementCount === 0
      ? `${light.ledCount} LEDs · ${stripBeadCaption(light.stripBead)} · no Elements`
      : `${light.ledCount} LEDs · ${stripBeadCaption(light.stripBead)} · ${light.elementCount} Element${
          light.elementCount === 1 ? "" : "s"
        }`;
  const segmentLine =
    light.segmentCount === null
      ? "segments unknown"
      : `${light.segmentCount} segment${light.segmentCount === 1 ? "" : "s"}`;

  return (
    <Link
      id={`light-${light.id}`}
      href={`/lights/${light.id}`}
      className="grid items-center gap-5 rounded-xl border border-border bg-card px-[18px] py-4 md:grid-cols-[200px_minmax(0,1fr)]"
    >
      <div className="flex flex-col gap-1.5">
        <span className="text-base font-medium">{light.name}</span>
        <span className={unreachable ? "text-xs text-destructive" : "text-xs text-online"}>
          {status}
        </span>
        <span className="font-mono text-[11px] leading-4 text-quiet">
          {light.displayHost}
          <br />
          {elementLine}
          {` · ${segmentLine}`}
          {light.firmware ? ` · ${light.firmware}` : ""}
        </span>
        {light.driftLabel ? (
          <span className="text-xs text-primary">{light.driftLabel}</span>
        ) : null}
      </div>
      <StripBeads
        id={`rack-${light.id}`}
        count={Math.min(Math.max(light.ledCount, 1), 300)}
        perRow={100}
        pitch={6.8}
        gutter={0}
        top={8}
        bottom={4}
        color={() => bead}
        brightness={unreachable ? 1 : 0.8}
        rgbw={light.stripBead === "rgbw"}
        ariaLabel={`${light.name} strip, ${stripBeadCaption(light.stripBead)}`}
      />
    </Link>
  );
}

function UnenrolledTray({ rows }: { rows: DiscoverRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[#3a4150] px-4 py-4 text-[13px] leading-5 text-quiet">
        Unenrolled WLEDs wait here after a find. Nothing in the tray until a
        controller answers.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => (
        <div
          key={row.key}
          className="flex flex-col gap-3 rounded-xl border border-dashed border-[#3a4150] px-4 py-3 sm:flex-row sm:items-center"
        >
          <div className="w-[180px]">
            <MiniStrip
              id={`tray-${row.key}`}
              bead={row.bead}
              count={36}
            />
          </div>
          <div className="flex flex-col gap-0.5">
            <span>{row.name ?? "WLED"} is on this network but not added</span>
            <span className="font-mono text-[11px] text-quiet">
              {row.displayHost} · found via {row.via === "targets" ? "listed address" : row.via}
            </span>
            {row.portWarning ? (
              <span className="mt-1 text-xs leading-5 text-primary">{row.portWarning}</span>
            ) : null}
          </div>
          <Link href="/discover" className="text-primary sm:ml-auto">
            Look at it
          </Link>
        </div>
      ))}
    </div>
  );
}
