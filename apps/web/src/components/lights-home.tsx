"use client";

import {
  BLINK_PULSE_MS,
  formatNodeLength,
  PHYSICAL_LENGTH_CAPTION,
  PROVISION_LED_TYPES,
  provisionLedTypeLabel,
  stripBeadCaption,
  WLED_COL_ORDER_RGB,
  type DiscoverRow,
  type LightView,
  type ProvisionLedType,
  type SetupApplyRow,
  type SetupProfile,
} from "@nightplot/shared";
import Link from "next/link";
import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { useDiscoveryCandidates } from "@/components/discovery-watch";
import { StripBeads } from "@/components/strip-beads";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fetchJson, postJson } from "@/lib/api";
import { displayBead } from "@/lib/power-status";
import { answeredLabel, brightnessPct, lastSeenLabel } from "@/lib/time";
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
            on any strip until you add one. A Light is one controller and may
            have several outputs. Segments — inclusive–exclusive ranges, gaps
            allowed — appear after that.
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

  return <LightsRack lights={lights} tray={tray} />;
}

function LightsRack({ lights, tray }: { lights: LightView[]; tray: DiscoverRow[] }) {
  const [selected, setSelected] = useState<string[]>([]);

  function toggle(id: string) {
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
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
      <FleetSetupBar
        selectedIds={selected}
        onSelectAll={() => setSelected(lights.map((light) => light.id))}
        onClear={() => setSelected([])}
      />
      {lights.map((light) => (
        <LightCard
          key={light.id}
          light={light}
          selected={selected.includes(light.id)}
          onToggle={() => toggle(light.id)}
        />
      ))}
      <FoundBanner rows={tray} />
    </div>
  );
}

function LightCard({
  light,
  selected,
  onToggle,
}: {
  light: LightView;
  selected: boolean;
  onToggle: () => void;
}) {
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
      <div className="pointer-events-none flex flex-wrap items-center gap-3">
        <label className="pointer-events-auto relative z-10 flex items-center gap-2 text-[13px] text-muted-foreground">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            onClick={(event) => event.stopPropagation()}
            aria-label={`Select ${light.name}`}
          />
        </label>
        <span className="text-[18px] font-medium">{light.name}</span>
        <span className={cn("inline-flex items-center gap-1.5 text-[13px]", status.className)}>
          <span className="size-1.5 rounded-full" style={{ background: status.dot }} />
          {status.label}
        </span>
        {!unreachable ? <CardHeartbeat lastSeenAt={light.lastSeenAt} /> : null}
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
          {light.outputs && light.outputs.length > 1
            ? `${light.outputs.length} outputs · ${light.ledCount} LEDs`
            : `${light.ledCount} LEDs`}
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

function CardHeartbeat({ lastSeenAt }: { lastSeenAt: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => { if (document.visibilityState !== "hidden") setNow(Date.now()); };
    const timer = window.setInterval(tick, 1_000);
    document.addEventListener("visibilitychange", tick);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", tick); };
  }, []);
  return <span className="whitespace-nowrap text-[12px] text-muted-foreground" suppressHydrationWarning>{answeredLabel(lastSeenAt, now)}</span>;
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

function optionalInt(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function FleetSetupBar({
  selectedIds,
  onSelectAll,
  onClear,
}: {
  selectedIds: string[];
  onSelectAll: () => void;
  onClear: () => void;
}) {
  const [profiles, setProfiles] = useState<SetupProfile[]>([]);
  const [profileId, setProfileId] = useState("");
  const [ledType, setLedType] = useState<"" | ProvisionLedType>("");
  const [colorOrder, setColorOrder] = useState("");
  const [gpio, setGpio] = useState("");
  const [length, setLength] = useState("");
  const [bootBrightness, setBootBrightness] = useState("");
  const [currentLimitMa, setCurrentLimitMa] = useState("");
  const [namePattern, setNamePattern] = useState("");
  const [saveName, setSaveName] = useState("");
  const [busy, setBusy] = useState<"apply" | "save" | null>(null);
  const [results, setResults] = useState<SetupApplyRow[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function loadProfiles() {
    try {
      const payload = await fetchJson<{ profiles: SetupProfile[] }>("/api/setup-profiles");
      setProfiles(payload.profiles);
    } catch {
      /* Saved profiles are optional; inline apply still runs. */
    }
  }

  function draftProfile() {
    const nextGpio = optionalInt(gpio);
    const nextLength = optionalInt(length);
    const nextBri = optionalInt(bootBrightness);
    const nextLimit = optionalInt(currentLimitMa);
    return {
      name: saveName.trim() || "Setup profile",
      ...(ledType ? { ledType } : {}),
      ...(colorOrder ? { colorOrder } : {}),
      ...(nextGpio !== undefined ? { gpio: nextGpio } : {}),
      ...(nextLength !== undefined ? { length: nextLength } : {}),
      ...(nextBri !== undefined ? { bootBrightness: nextBri } : {}),
      ...(nextLimit !== undefined ? { currentLimitMa: nextLimit } : {}),
      ...(namePattern.trim() ? { namePattern: namePattern.trim() } : {}),
    };
  }

  async function saveProfile() {
    setBusy("save");
    setNotice(null);
    const res = await postJson<{ profile: SetupProfile }>("/api/setup-profiles", {
      profile: draftProfile(),
    });
    setBusy(null);
    if (!res.ok) {
      setNotice(res.data.message ?? "Setup profile was not saved.");
      return;
    }
    setProfiles((current) => [...current.filter((row) => row.id !== res.data.profile.id), res.data.profile]);
    setProfileId(res.data.profile.id);
    setNotice("Setup profile saved. Nothing was written to WLED.");
  }

  async function apply() {
    if (selectedIds.length === 0) return;
    setBusy("apply");
    setNotice(null);
    setResults(null);
    const res = await postJson<{ results: SetupApplyRow[]; message?: string }>(
      "/api/lights/setup-profile",
      {
        lightIds: selectedIds,
        ...(profileId ? { profileId } : {}),
        profile: draftProfile(),
      },
    );
    setBusy(null);
    if (!res.ok) {
      setNotice(res.data.message ?? "Apply setup profile did not run.");
      return;
    }
    setResults(res.data.results);
    setNotice(res.data.message ?? null);
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-[#12141a] p-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-[13px] text-[#c9c3b8]">
          {selectedIds.length === 0
            ? "Select Lights to apply a setup profile."
            : `${selectedIds.length} selected`}
        </span>
        <Button type="button" variant="outline" className="h-8" onClick={onSelectAll}>
          Select all
        </Button>
        <Button type="button" variant="ghost" className="h-8" onClick={onClear} disabled={selectedIds.length === 0}>
          Clear
        </Button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col gap-1 text-[12px] text-quiet">
          Saved profile
          <select
            className="h-9 rounded-md border border-input bg-[#07080a] px-2 text-[13px] text-foreground"
            value={profileId}
            onFocus={() => void loadProfiles()}
            onChange={(event) => setProfileId(event.target.value)}
          >
            <option value="">Inline only</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-quiet">
          LED type
          <select
            className="h-9 rounded-md border border-input bg-[#07080a] px-2 text-[13px] text-foreground"
            value={ledType}
            onChange={(event) => setLedType(event.target.value as "" | ProvisionLedType)}
          >
            <option value="">Keep each output</option>
            {PROVISION_LED_TYPES.map((type) => (
              <option key={type} value={type}>
                {provisionLedTypeLabel(type)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-quiet">
          Colour order
          <select
            className="h-9 rounded-md border border-input bg-[#07080a] px-2 text-[13px] text-foreground"
            value={colorOrder}
            onChange={(event) => setColorOrder(event.target.value)}
          >
            <option value="">Keep / mapping default</option>
            {WLED_COL_ORDER_RGB.map((order) => (
              <option key={order} value={order}>
                {order}
              </option>
            ))}
            {WLED_COL_ORDER_RGB.map((order) => (
              <option key={`${order}W`} value={`${order}W`}>
                {order}W
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-quiet">
          Name pattern
          <Input value={namePattern} onChange={(event) => setNamePattern(event.target.value)} placeholder="yard-{nn}" />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-quiet">
          GPIO
          <Input inputMode="numeric" value={gpio} onChange={(event) => setGpio(event.target.value)} placeholder="keep" />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-quiet">
          Length
          <Input inputMode="numeric" value={length} onChange={(event) => setLength(event.target.value)} placeholder="keep" />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-quiet">
          Boot brightness
          <Input inputMode="numeric" value={bootBrightness} onChange={(event) => setBootBrightness(event.target.value)} placeholder="keep" />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-quiet">
          Current limit mA
          <Input inputMode="numeric" value={currentLimitMa} onChange={(event) => setCurrentLimitMa(event.target.value)} placeholder="keep" />
        </label>
      </div>
      <p className="text-[12px] leading-5 text-quiet">
        Apply writes each selected controller with an automatic backup first. One dead
        Light does not stop the rest. Undo is that backup on Backups — there is no
        confirm step. Not Hardware Done.
      </p>
      <div className="flex flex-wrap items-center gap-2.5">
        <Input
          className="max-w-[200px]"
          value={saveName}
          onChange={(event) => setSaveName(event.target.value)}
          placeholder="Profile name"
        />
        <Button type="button" variant="outline" disabled={busy !== null} onClick={() => void saveProfile()}>
          {busy === "save" ? "Saving…" : "Save profile"}
        </Button>
        <Button type="button" disabled={busy !== null || selectedIds.length === 0} onClick={() => void apply()}>
          {busy === "apply" ? "Applying…" : "Apply setup profile"}
        </Button>
      </div>
      {notice ? <p className="text-[13px] text-[#c9c3b8]">{notice}</p> : null}
      {results ? (
        <div className="flex flex-col gap-1">
          {results.map((row) => (
            <p key={row.lightId} className="text-[13px] leading-5 text-[#c9c3b8]">
              {row.name} · {row.status === "applied" ? "Applied" : row.reason ?? "Failed"}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
