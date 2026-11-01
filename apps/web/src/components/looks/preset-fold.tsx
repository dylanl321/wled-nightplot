"use client";

import type { SyncResult, WledPresetSummary } from "@nightplot/shared";
import { useState } from "react";
import { fetchJson, postJson } from "@/lib/api";
import type { LightLite } from "./use-looks";

const STATUS_COPY: Record<SyncResult["rows"][number]["status"], string> = {
  matched: "On", mismatch: "Differs", unknown: "Not confirmed", failed: "Failed", refused: "Not sent",
};

/**
 * A WLED preset Nightplot did not make (set up in the WLED app): read the
 * list from one Light and turn the same number on across Lights.
 */
export function PresetFold({ lights }: { lights: LightLite[] }) {
  const [sourceId, setSourceId] = useState(lights[0]?.id ?? "");
  const [picked, setPicked] = useState<Set<string>>(() => new Set(lights.map((light) => light.id)));
  const [presets, setPresets] = useState<WledPresetSummary[] | null>(null);
  const [presetId, setPresetId] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SyncResult | null>(null);
  const source = lights.find((light) => light.id === sourceId);
  const nameOf = (id: string) => lights.find((light) => light.id === id)?.name ?? id;

  async function run(label: string, work: () => Promise<void>) {
    setBusy(label); setError(null);
    try { await work(); } catch (caught) { setError(caught instanceof Error ? caught.message : "That did not finish. Check each Light."); } finally { setBusy(null); }
  }

  if (!lights.length) return null;
  return (
    <details className="fold">
      <summary>Another WLED preset <span className="meta">set up in the WLED app</span></summary>
      <div className="foldbody">
        <p className="note">Turns on the same WLED preset number on each ticked Light. A Light without that preset is skipped and listed.</p>
        <div className="btnrow">
          <select className="in" aria-label="Read presets from" value={sourceId} style={{ width: "auto" }} onChange={(event) => { setSourceId(event.target.value); setPresets(null); setPresetId(null); }}>
            {lights.map((light) => <option key={light.id} value={light.id}>{light.name}</option>)}
          </select>
          <button type="button" className="btn small" disabled={Boolean(busy) || !source} onClick={() => run("Reading presets…", async () => {
            const data = await fetchJson<{ presets: WledPresetSummary[] }>(`/api/sync/presets/${sourceId}`);
            setPresets(data.presets); setPresetId(data.presets[0]?.id ?? null);
          })}>{presets ? "Read again" : "Read presets"}</button>
          {presets ? (presets.length ? (
            <select className="in" aria-label="Preset" value={presetId ?? ""} style={{ width: "auto" }} onChange={(event) => setPresetId(Number(event.target.value))}>
              {presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.id} · {preset.name}{preset.kind === "playlist" ? " (playlist)" : ""}</option>)}
            </select>
          ) : <span className="note">{source?.name} has no saved presets.</span>) : null}
        </div>
        <div>
          {lights.map((light) => (
            <label className="check" key={light.id}>
              <input type="checkbox" checked={picked.has(light.id)} onChange={(event) => setPicked((set) => { const next = new Set(set); if (event.target.checked) next.add(light.id); else next.delete(light.id); return next; })} />
              {light.name}
            </label>
          ))}
        </div>
        <div className="btnrow">
          <button type="button" className="btn primary small" disabled={Boolean(busy) || presetId === null || picked.size === 0} onClick={() => run(`Turning on preset ${presetId}…`, async () => {
            const res = await postJson<SyncResult>("/api/sync/preset", { lightIds: lights.filter((light) => picked.has(light.id)).map((light) => light.id), presetId });
            if (!res.ok) throw new Error(res.data.message ?? "The preset was not sent.");
            setResult(res.data);
          })}>Turn on</button>
          {busy ? <span className="note">{busy}</span> : null}
        </div>
        {error ? <p className="warnnote" role="alert">{error}</p> : null}
        {result ? (
          <div role="status">
            <p className="note">{result.message} The Schedule takes over at its next step.</p>
            {result.rows.map((row) => <div className="resrow" key={row.lightId}><b>{nameOf(row.lightId)}</b><span className={`st ${row.status === "matched" ? "ok" : "bad"}`}>{STATUS_COPY[row.status]}</span><span className="why">{row.detail}</span></div>)}
          </div>
        ) : null}
      </div>
    </details>
  );
}
