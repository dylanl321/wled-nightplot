"use client";

import type { LightDetail as LightDetailPayload, ReaddressStep } from "@nightplot/shared";
import type { ReactNode } from "react";
import { DeleteLight } from "@/components/delete-light";
import { SafeSettingsPanel } from "@/components/safe-settings";
import { StripProvisionPanel } from "@/components/strip-provision";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function SettingsPanel({
  detail,
  addressOpen,
  addressHost,
  addressSteps,
  addressBusy,
  onToggleAddress,
  onHost,
  onCheck,
  onUpdated,
}: {
  detail: LightDetailPayload;
  addressOpen: boolean;
  addressHost: string;
  addressSteps: ReaddressStep[] | null;
  addressBusy: boolean;
  onToggleAddress: () => void;
  onHost: (value: string) => void;
  onCheck: () => void;
  onUpdated: (next: LightDetailPayload) => void;
}) {
  const light = detail.light;
  const unreachable = light.reachability === "no-answer";

  return (
    <div className="flex flex-col">
      <Section
        title="Strip hardware"
        blurb="What’s wired to the controller. Apply writes it, then reads it back."
      >
        <StripProvisionPanel
          lightId={light.id}
          unreachable={unreachable}
          embedded
          onUpdated={onUpdated}
        />
      </Section>
      <Section
        title="Controller"
        blurb="Only the fields Nightplot understands on this firmware."
      >
        <SafeSettingsPanel
          lightId={light.id}
          unreachable={unreachable}
          embedded
          staleInfoName={light.staleInfoName}
          onUpdated={onUpdated}
        />
      </Section>
      <Section title="Network" blurb="From the last snapshot.">
        <div className="grid grid-cols-[120px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 text-[13px]">
          <span className="text-muted-foreground">Address</span>
          <span className="font-mono">{light.displayHost}</span>
          <button type="button" onClick={onToggleAddress} className="text-[13px] text-primary">
            Change…
          </button>
          <span className="text-muted-foreground">MAC</span>
          <span className="col-span-2 font-mono">{light.mac ?? "—"}</span>
          <span className="text-muted-foreground">Firmware</span>
          <span className="col-span-2 font-mono">{light.firmware ?? "—"}</span>
        </div>
        <p className="mt-3 text-[13px] text-muted-foreground">
          {light.segmentCount === null
            ? "Segments unknown"
            : `${light.segmentCount} segment${light.segmentCount === 1 ? "" : "s"} reported`}
        </p>
        {addressOpen ? (
          <div className="mt-3 flex flex-col gap-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <span className="font-mono text-[13px] text-muted-foreground">{light.displayHost} →</span>
              <Input
                value={addressHost}
                onChange={(event) => onHost(event.target.value)}
                aria-label="New host or host:port"
                className="font-mono"
              />
              <Button onClick={onCheck} disabled={addressBusy || !addressHost.trim()}>
                {addressBusy ? "Checking…" : "Check"}
              </Button>
            </div>
            {addressSteps?.length ? (
              <div className="flex flex-col gap-1.5 text-[13px]">
                {addressSteps.map((step) => (
                  <div key={step.text} className="flex gap-2">
                    <span className={step.done ? "text-online" : "text-destructive"}>
                      {step.done ? "✓" : "–"}
                    </span>
                    <span className="text-[#c9c3b8]">{step.text}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[12px] text-muted-foreground">
                Probes the new address first. Switches only when the same MAC answers. Identity
                comes from that snapshot.
              </p>
            )}
          </div>
        ) : null}
      </Section>
      <Section
        title="Remove"
        blurb="Nightplot forgets it. The controller isn’t changed."
        last
      >
        <DeleteLight
          lightId={light.id}
          name={light.name}
          initialChecks={detail.deleteChecks}
          alwaysOpen
        />
      </Section>
    </div>
  );
}

function Section({
  title,
  blurb,
  last,
  children,
}: {
  title: string;
  blurb: string;
  last?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={
        last
          ? "grid grid-cols-1 gap-7 pt-2 pb-6 lg:grid-cols-[240px_minmax(0,1fr)]"
          : "grid grid-cols-1 gap-7 border-b border-border pt-2 pb-6 lg:grid-cols-[240px_minmax(0,1fr)]"
      }
    >
      <div>
        <h3 className="text-[16px] font-semibold">{title}</h3>
        <p className="mt-1 text-[13px] leading-normal text-muted-foreground">{blurb}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}
