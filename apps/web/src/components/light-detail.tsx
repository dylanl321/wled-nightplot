"use client";

import {
  BLINK_PULSE_MS,
  PHYSICAL_LENGTH_CAPTION,
  blinkRefuseReason,
  formatNodeLength,
  type LightDetail as LightDetailPayload,
  type ReaddressStep,
} from "@nightplot/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ElementsPanel } from "@/components/elements-panel";
import { SettingsPanel } from "@/components/settings-panel";
import { Button } from "@/components/ui/button";
import { fetchJson, postJson } from "@/lib/api";
import { inspectPowerHow } from "@/lib/power-status";
import { brightnessPct, lastSeenLabel, snapshotLabel } from "@/lib/time";
import { cn } from "@/lib/utils";

type DetailTab = "elements" | "settings";
type LegacyMode = "inspect" | "ranges" | "live" | "safe" | "strip";

export function LightDetail({
  initial,
  mode,
  tab: tabProp,
}: {
  initial: LightDetailPayload;
  mode?: LegacyMode;
  tab?: DetailTab;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<DetailTab>(tabProp ?? tabFromMode(mode));
  const [detail, setDetail] = useState(initial);
  const [busy, setBusy] = useState<"save" | "refresh" | "apply" | "readdress" | "blink" | null>(
    null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [addressOpen, setAddressOpen] = useState(false);
  const [addressHost, setAddressHost] = useState(initial.light.displayHost);
  const [addressSteps, setAddressSteps] = useState<ReaddressStep[] | null>(null);

  const light = detail.light;
  const unreachable = light.reachability === "no-answer";

  useEffect(() => {
    if (!mode) return;
    const path =
      tab === "settings" ? `/lights/${initial.light.id}?tab=settings` : `/lights/${initial.light.id}`;
    if (window.location.search.includes("mode=")) {
      window.history.replaceState(null, "", path);
    }
  }, [initial.light.id, mode, tab]);

  useEffect(() => {
    function onLightsChanged() {
      void fetchJson<LightDetailPayload>(`/api/lights/${initial.light.id}`)
        .then((next) => {
          setDetail(next);
        })
        .catch(() => {
          /* keep the open Light */
        });
    }
    window.addEventListener("nightplot:lights-changed", onLightsChanged);
    return () => window.removeEventListener("nightplot:lights-changed", onLightsChanged);
  }, [initial.light.id]);

  useEffect(() => {
    if (detail.session?.kind !== "blink") return;
    const wait = window.setTimeout(() => {
      void postJson<LightDetailPayload>(`/api/lights/${light.id}/blink/end`, {}).then((res) => {
        if (res.ok) setDetail(res.data);
      });
    }, BLINK_PULSE_MS);
    return () => window.clearTimeout(wait);
  }, [detail.session?.id, detail.session?.kind, light.id]);

  function goTab(next: DetailTab) {
    setTab(next);
    const path =
      next === "settings" ? `/lights/${light.id}?tab=settings` : `/lights/${light.id}`;
    window.history.replaceState(null, "", path);
  }

  const blinkReason = blinkRefuseReason({
    reachable: !unreachable,
    busyKind: detail.session?.kind ?? null,
  });

  async function refresh() {
    setBusy("refresh");
    setNotice(null);
    try {
      const next = await fetchJson<LightDetailPayload>(`/api/lights/${light.id}`);
      setDetail(next);
      router.refresh();
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Refresh failed.");
    }
    setBusy(null);
  }

  async function readdress() {
    setBusy("readdress");
    setNotice(null);
    const res = await postJson<
      LightDetailPayload & {
        readdress?: { steps?: ReaddressStep[]; switched?: boolean };
        steps?: ReaddressStep[];
        message?: string;
      }
    >(`/api/lights/${light.id}/readdress`, { host: addressHost });
    setBusy(null);
    const payload = res.data as LightDetailPayload & {
      readdress?: { steps?: ReaddressStep[] };
      steps?: ReaddressStep[];
      message?: string;
    };
    const steps = payload.readdress?.steps ?? payload.steps ?? null;
    if (steps) setAddressSteps(steps);
    if (res.ok && payload.light) {
      setDetail(payload);
      setAddressHost(payload.light.displayHost);
      router.refresh();
      return;
    }
    setNotice(payload.message ?? "Address was not changed.");
  }

  async function blink() {
    if (blinkReason) {
      setNotice(blinkReason);
      return;
    }
    setBusy("blink");
    setNotice(null);
    const res = await postJson<LightDetailPayload>(`/api/lights/${light.id}/blink`, {});
    setBusy(null);
    if (!res.ok) {
      setNotice(res.data.message ?? "Nothing was sent.");
      return;
    }
    setDetail(res.data);
  }

  const status = powerLine(light);
  const stripLength = formatNodeLength(light.ledCount, light.spacingMm);
  const updated = unreachable
    ? lastSeenLabel(light.lastSeenAt).replace(/^last seen/, "Updated")
    : snapshotLabel(detail.snapshotAt).replace(/^Snapshot/, "Updated");

  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-1 flex-col gap-4 px-6 pt-6 pb-32 sm:px-10">
      <p className="text-[13px] text-muted-foreground">
        <Link href="/" className="hover:text-foreground">
          Lights
        </Link>
        <span> / {light.name}</span>
      </p>
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3.5">
          <h1 className="text-[28px] font-semibold tracking-[-0.01em]">{light.name}</h1>
          <span className={cn("inline-flex items-center gap-1.5 text-[14px]", status.className)}>
            <span className="size-[7px] rounded-full" style={{ background: status.dot }} />
            {status.label}
          </span>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-3">
            <div className="text-right">
              <span className="text-[13px] text-muted-foreground">
                {light.ledCount} LEDs{stripLength ? ` · ${stripLength}` : ""} · {light.stripChip}
              </span>
              {stripLength ? (
                <span className="mt-0.5 block text-[11px] text-quiet">{PHYSICAL_LENGTH_CAPTION}</span>
              ) : null}
            </div>
            <span className="text-[12px] text-muted-foreground" suppressHydrationWarning>
              {updated}
            </span>
            <Button
              type="button"
              variant="outline"
              className="h-[34px] px-3 text-[13px]"
              onClick={() => void refresh()}
              disabled={busy === "refresh"}
            >
              {busy === "refresh" ? "Refreshing…" : "Refresh"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-[34px] px-3 text-[13px]"
              onClick={() => void blink()}
              disabled={unreachable || Boolean(blinkReason) || busy !== null}
            >
              {busy === "blink" ? "Blinking…" : "Blink"}
            </Button>
          </div>
        </div>
        {unreachable ? (
          <p className="text-[13px] text-destructive">{inspectPowerHow(light)}</p>
        ) : null}
        <div className="flex gap-6 border-b border-border">
          <TabButton active={tab === "elements"} onClick={() => goTab("elements")}>
            Elements
          </TabButton>
          <TabButton active={tab === "settings"} onClick={() => goTab("settings")}>
            Settings
          </TabButton>
        </div>
      </header>

      {tab === "settings" ? (
        <SettingsPanel
          detail={detail}
          addressOpen={addressOpen}
          addressHost={addressHost}
          addressSteps={addressSteps}
          addressBusy={busy === "readdress"}
          onToggleAddress={() => {
            setAddressOpen((open) => !open);
            setAddressSteps(null);
            setAddressHost(light.displayHost);
          }}
          onHost={setAddressHost}
          onCheck={() => void readdress()}
          onUpdated={(next) => {
            setDetail(next);
            router.refresh();
          }}
        />
      ) : (
        <ElementsPanel
          detail={detail}
          busy={busy}
          notice={notice}
          onBusy={setBusy}
          onNotice={setNotice}
          onDetail={setDetail}
          onSettings={() => goTab("settings")}
          onRefresh={() => router.refresh()}
        />
      )}
      {tab === "settings" && notice ? (
        <p className="text-[13px] text-destructive">{notice}</p>
      ) : null}
    </div>
  );
}

function powerLine(light: LightDetailPayload["light"]): {
  label: string;
  className: string;
  dot: string;
} {
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

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "pb-2.5 text-[14px]",
        active
          ? "font-medium shadow-[inset_0_-2px_0_#d4a574]"
          : "text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}

function tabFromMode(mode: LegacyMode | undefined): DetailTab {
  if (mode === "inspect" || mode === "strip" || mode === "safe") return "settings";
  return "elements";
}
