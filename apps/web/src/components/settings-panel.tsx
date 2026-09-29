"use client";

import type { LightDetail as LightDetailPayload, ReaddressStep } from "@nightplot/shared";
import type { ReactNode } from "react";
import { DeleteLight } from "@/components/delete-light";
import { ControllerReplacement } from "@/components/controller-replacement";
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
      <Section
        title="Health"
        blurb="Current readings from this Light; no controller changes."
      >
        {!detail.health ? (
          <p className="text-[13px] text-muted-foreground">Current health unavailable. {light.lastSeenAt ? `Last seen ${new Date(light.lastSeenAt).toLocaleString()}.` : "No last-seen report."}</p>
        ) : (
          <div className="space-y-3 text-[13px]">
            <dl className="grid grid-cols-[140px_minmax(0,1fr)] gap-y-2">
              <dt className="text-muted-foreground">WLED version</dt><dd>{light.firmware ?? "Unknown"}</dd>
              <dt className="text-muted-foreground">Uptime</dt><dd>{detail.health.uptimeSeconds === null ? "Not reported" : formatUptime(detail.health.uptimeSeconds)}</dd>
              <dt className="text-muted-foreground">Wi-Fi signal</dt><dd>{detail.health.wifiSignalPercent === null ? "Not reported" : `${detail.health.wifiSignalPercent}%`}{detail.health.wifiRssiDbm === null ? "" : ` · ${detail.health.wifiRssiDbm} dBm`}</dd>
              <dt className="text-muted-foreground">Free memory</dt><dd>{detail.health.freeHeapBytes === null ? "Not reported" : `${(detail.health.freeHeapBytes / 1024).toFixed(1)} KiB`}</dd>
            </dl>
            {detail.health.compatibilityNotice ? <p role="status" className="rounded-lg border border-amber-500/40 p-3 text-amber-200">{detail.health.compatibilityNotice}</p> : null}
          </div>
        )}
      </Section>
      <Section
        title="Network"
        blurb="The address Nightplot uses to reach this Light. Changing it does not rename the controller."
      >
        <div className="grid grid-cols-[120px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 text-[13px]">
          <span className="text-muted-foreground">Hostname</span>
          <span className="font-mono">{light.hostname}</span>
          <button type="button" onClick={onToggleAddress} className="text-[13px] text-primary">
            Change…
          </button>
          <span className="text-muted-foreground">Port</span>
          <span className="col-span-2 font-mono">{light.port}</span>
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
        <ControllerReplacement detail={detail} onUpdated={onUpdated} />
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

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return [days ? `${days}d` : null, hours || days ? `${hours}h` : null, `${minutes}m`].filter(Boolean).join(" ");
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
