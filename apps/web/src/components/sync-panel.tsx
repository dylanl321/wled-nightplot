"use client";

import type { LightView, SyncResult, SyncWarning, WledPresetSummary } from "@nightplot/shared";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { UdpSyncSection } from "@/components/udp-sync-section";
import { fetchJson, postJson } from "@/lib/api";

type Action = "presets" | "look";
type Pending = { action: Action; warnings: SyncWarning[] };

const STATUS_COPY: Record<SyncResult["rows"][number]["status"], string> = {
  matched: "Matched",
  mismatch: "Differs",
  unknown: "Unknown",
  failed: "Failed",
  refused: "Not sent",
};

/** Push presets, colours and effects, or one preset across Lights. Each run rereads; nothing stays in step afterwards. */
export function SyncPanel({ lights }: { lights: LightView[] }) {
  const [sourceId, setSourceId] = useState(lights[0]?.id ?? "");
  const [targetIds, setTargetIds] = useState<string[]>([]);
  const [presets, setPresets] = useState<WledPresetSummary[] | null>(null);
  const [presetId, setPresetId] = useState<number | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const source = lights.find((light) => light.id === sourceId) ?? null;
  const targets = targetIds.filter((id) => id !== sourceId);
  const nameOf = (id: string) => lights.find((light) => light.id === id)?.name ?? id;

  function chooseSource(id: string) {
    setSourceId(id);
    setTargetIds((current) => current.filter((entry) => entry !== id));
    setPresets(null);
    setPresetId(null);
    setPending(null);
  }

  function toggle(id: string) {
    setPending(null);
    setTargetIds((current) => current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]);
  }

  async function run(label: string, work: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try { await work(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Sync did not finish. Check each Light before retrying."); }
    finally { setBusy(null); }
  }

  async function copy(action: Action, confirmWarnings = false) {
    await run(action === "presets" ? "Copying presets…" : "Copying colours and effects…", async () => {
      const res = await postJson<SyncResult>(`/api/sync/${action}`,
        { sourceLightId: sourceId, targetLightIds: targets, confirmWarnings });
      if (!res.ok) {
        const data = res.data as { error?: string; message?: string; warnings?: SyncWarning[] };
        if (data.error === "confirm-warnings" && data.warnings) { setPending({ action, warnings: data.warnings }); return; }
        throw new Error(data.message ?? "Sync was refused. Nothing was sent.");
      }
      setPending(null);
      setResult(res.data);
    });
  }

  async function loadPresets() {
    await run("Reading presets…", async () => {
      const data = await fetchJson<{ presets: WledPresetSummary[] }>(`/api/sync/presets/${sourceId}`);
      setPresets(data.presets);
      setPresetId(data.presets[0]?.id ?? null);
    });
  }

  async function turnOn() {
    if (presetId === null) return;
    await run(`Turning on preset ${presetId}…`, async () => {
      const res = await postJson<SyncResult>("/api/sync/preset", { lightIds: [sourceId, ...targets], presetId });
      if (!res.ok) throw new Error(res.data.message ?? "Preset was not sent.");
      setResult(res.data);
    });
  }

  if (lights.length < 2) {
    return <section className="flex flex-1 flex-col gap-3 px-5 py-10 sm:px-8">
      <h1 className="text-[26px] font-semibold tracking-[-0.01em]">Sync</h1>
      <p className="text-[14px] text-muted-foreground">Sync needs at least two Lights. Find and enroll another controller first.</p>
    </section>;
  }

  const disabled = Boolean(busy) || !source;
  return <section className="flex flex-1 flex-col gap-6 px-5 py-8 sm:px-8">
    <div className="flex flex-col gap-1">
      <h1 className="text-[26px] font-semibold tracking-[-0.01em]">Sync</h1>
      <p className="text-[14px] text-muted-foreground">Push WLED presets, colours and effects, or one preset from one Light to others. Each Light is reread afterwards. Nightplot does not keep them in step after the push.</p>
    </div>

    <div className="grid gap-6 lg:grid-cols-2">
      <label className="flex flex-col gap-2 text-[14px]">
        <span className="font-medium">Copy from</span>
        <select aria-label="Copy from" className="h-10 rounded-md border border-border bg-background px-3"
          value={sourceId} onChange={(event) => chooseSource(event.target.value)}>
          {lights.map((light) => <option key={light.id} value={light.id}>{light.name}</option>)}
        </select>
      </label>
      <fieldset className="flex flex-col gap-2 text-[14px]">
        <legend className="mb-2 font-medium">To these Lights</legend>
        {lights.filter((light) => light.id !== sourceId).map((light) => (
          <label key={light.id} className="flex items-center gap-2">
            <input type="checkbox" checked={targetIds.includes(light.id)} onChange={() => toggle(light.id)} />
            <span>{light.name}</span>
            {light.reachability !== "online" ? <span className="text-quiet">· last seen offline</span> : null}
          </label>
        ))}
      </fieldset>
    </div>

    <div className="flex flex-wrap gap-3">
      <Button disabled={disabled || targets.length === 0} onClick={() => copy("presets")}>Copy presets</Button>
      <Button variant="outline" disabled={disabled || targets.length === 0} onClick={() => copy("look")}>Copy colours and effects</Button>
    </div>
    <p className="-mt-3 text-[12px] text-quiet">Copy presets replaces each target’s WLED presets.json after a safety backup of its configuration and presets. Copy colours and effects changes what each Light shows now and keeps its own segment ranges.</p>

    {pending ? <div role="alert" className="flex flex-col gap-2 rounded-[14px] border border-border p-4 text-[13px]">
      <p className="font-medium">Review before copying. Nothing was sent.</p>
      <ul className="list-disc pl-5">{pending.warnings.map((warning, index) => <li key={index}>{warning.message}</li>)}</ul>
      <div className="flex gap-2">
        <Button disabled={disabled} onClick={() => copy(pending.action, true)}>Copy anyway</Button>
        <Button variant="outline" disabled={disabled} onClick={() => setPending(null)}>Cancel</Button>
      </div>
    </div> : null}

    <div className="flex flex-col gap-3 border-t border-border pt-5">
      <h2 className="text-[16px] font-medium">Turn on a preset</h2>
      <p className="text-[13px] text-muted-foreground">Turns on the same WLED preset number on {source?.name ?? "the source"}{targets.length ? ` and ${targets.length} more` : ""}. A Light without that preset is skipped and listed.</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" disabled={disabled} onClick={loadPresets}>{presets ? "Reload presets" : "Read presets"}</Button>
        {presets ? (presets.length ? <select aria-label="Preset" className="h-10 rounded-md border border-border bg-background px-3"
          value={presetId ?? ""} onChange={(event) => setPresetId(Number(event.target.value))}>
          {presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.id} · {preset.name}{preset.kind === "playlist" ? " (playlist)" : ""}</option>)}
        </select> : <span className="text-[13px] text-quiet">{source?.name} has no saved presets.</span>) : null}
        <Button disabled={disabled || presetId === null} onClick={turnOn}>Turn on</Button>
      </div>
    </div>

    {busy ? <p className="text-[13px] text-muted-foreground">{busy}</p> : null}
    {error ? <p role="alert" className="text-[13px] text-[#f0a3a3]">{error}</p> : null}

    {result ? <div className="flex flex-col gap-2 rounded-[14px] border border-border p-4 text-[13px]">
      <p className="font-medium">{result.message}</p>
      <ul className="flex flex-col gap-1">{result.rows.map((row) => (
        <li key={row.lightId}><span className="font-medium">{nameOf(row.lightId)}</span> · {STATUS_COPY[row.status]} · {row.detail}
          {row.safetyBackupId ? <span className="text-quiet"> Safety backup {row.safetyBackupId}.</span> : null}</li>
      ))}</ul>
      <p className="text-[12px] text-quiet">{result.caption}</p>
    </div> : null}
    <UdpSyncSection lights={lights} />
  </section>;
}
