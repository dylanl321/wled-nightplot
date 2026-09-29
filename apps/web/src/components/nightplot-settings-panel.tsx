"use client";

import type { LedProduct, LightView, NightplotSettings } from "@nightplot/shared";
import Link from "next/link";
import { useState } from "react";
import type { BackupSummary } from "@nightplot/shared";
import { fetchJson, patchJson, postJson } from "@/lib/api";

const inputClass = "rounded border border-border bg-card px-3 py-2 text-foreground";

export function NightplotSettingsPanel({ initial, products, lights }: {
  initial: NightplotSettings; products: LedProduct[]; lights: LightView[];
}) {
  const [draft, setDraft] = useState(initial);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [rotation, setRotation] = useState<{ remove: BackupSummary[]; room: boolean } | null>(null);
  const [configRead, setConfigRead] = useState<{ lightId: string; mac: string; firmware: string;
    sourceDigest: string; config: unknown } | null>(null);
  const change = (patch: Partial<NightplotSettings>) => setDraft((current) => ({ ...current, ...patch }));

  async function save() {
    setBusy(true);
    try {
      const result = await patchJson<{ settings: NightplotSettings; message: string }>("/api/settings", { settings: draft });
      if (!result.ok) { setNotice(result.data.message ?? "Nothing was saved."); return; }
      setDraft(result.data.settings);
      document.documentElement.dataset.theme = result.data.settings.appearance;
      setNotice(result.data.message);
    } catch { setNotice("Could not save preferences. Nothing was sent to WLED."); }
    finally { setBusy(false); }
  }
  async function reload() {
    try {
      const { settings } = await fetchJson<{ settings: NightplotSettings }>("/api/settings");
      setDraft(settings);
      setNotice("Current preferences loaded. Review before saving.");
    } catch { setNotice("Could not reload preferences."); }
  }
  async function previewRotation() {
    const result = await postJson<{ remove: BackupSummary[]; room: boolean }>("/api/backups/rotation-preview", { settings: draft });
    if (result.ok) setRotation(result.data);
    else setNotice(result.data.message ?? "Could not review backup rotation.");
  }
  async function loadConfig(lightId: string) {
    setConfigRead(null);
    try {
      setConfigRead(await fetchJson<{ lightId: string; mac: string; firmware: string;
        sourceDigest: string; config: unknown }>(`/api/lights/${lightId}/config`));
      setNotice("Fresh WLED configuration loaded for inspection. Nothing was sent.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "WLED configuration could not be read."); }
  }

  return <div className="mx-auto w-full max-w-4xl space-y-7 px-5 py-8 lg:px-8">
    <header><h1 className="font-serif text-3xl">Settings</h1>
      <p className="mt-2 text-muted-foreground">Nightplot preferences are shared across browsers. Save never writes to WLED; a reviewed Apply does.</p></header>
    <section className="space-y-3 rounded-lg border border-border bg-card p-5">
      <h2 className="text-lg">Defaults</h2>
      <p className="text-muted-foreground">Suggestions fill missing Strip-form values only. Reported hardware settings and product attachments are never replaced automatically.</p>
      <label className="block">Default LED product<br/><select className={inputClass} value={draft.defaultLedProductId ?? ""}
        onChange={(event) => change({ defaultLedProductId: event.target.value || null })}>
        <option value="">None</option>{products.map((product) => <option key={product.id} value={product.id}>{product.label}</option>)}
      </select></label>
      <div className="flex flex-wrap gap-4">{(["ledCount", "gpio"] as const).map((key) => <label key={key}>
        {key === "ledCount" ? "Strip node count" : "GPIO"}<br/><input className={inputClass} type="number"
          min={key === "ledCount" ? 1 : 0} max={key === "ledCount" ? 100000 : 48}
          value={draft.stripSuggestions[key] ?? ""} onChange={(event) =>
            change({ stripSuggestions: { ...draft.stripSuggestions, [key]: event.target.value === "" ? null : Number(event.target.value) } })} />
      </label>)}</div>
      <div className="flex flex-wrap gap-4"><label>Preview starting colour<br/><input className={inputClass} type="color" value={draft.preview.hex}
        onChange={(event) => change({ preview: { ...draft.preview, hex: event.target.value } })} /></label>
        <label>Fallback brightness (1–255)<br/><input className={inputClass} type="number" min={1} max={255} value={draft.preview.brightness}
          onChange={(event) => change({ preview: { ...draft.preview, brightness: Number(event.target.value) } })} /></label></div>
      <p className="text-muted-foreground">These values are used when Preview does not specify a colour or the Light reports no brightness. Held-Segment Preview dim remains 60%.</p>
    </section>
    <section className="space-y-3 rounded-lg border border-border bg-card p-5"><h2 className="text-lg">Segment colours</h2>
      <p className="text-muted-foreground">Palette changes are suggestions for new Segments; they do not recolour saved Segments.</p>
      <div className="grid gap-3 sm:grid-cols-2">{draft.palette.map((color, index) => <div key={index} className="flex items-center gap-2">
        <input aria-label={`Colour ${index + 1}`} type="color" value={color.hex} onChange={(event) =>
          change({ palette: draft.palette.map((entry, i) => i === index ? { ...entry, hex: event.target.value } : entry) })} />
        <input aria-label={`Name ${index + 1}`} className={inputClass} maxLength={32} value={color.name} onChange={(event) =>
          change({ palette: draft.palette.map((entry, i) => i === index ? { ...entry, name: event.target.value } : entry) })} />
      </div>)}</div>
    </section>
    <section className="space-y-3 rounded-lg border border-border bg-card p-5"><h2 className="text-lg">Appearance</h2>
      <label>Theme<br/><select className={inputClass} value={draft.appearance} onChange={(event) => change({ appearance: event.target.value as "dark" | "light" })}>
        <option value="dark">Dark</option><option value="light">Light</option></select></label></section>
    <section className="space-y-3 rounded-lg border border-border bg-card p-5"><h2 className="text-lg">Find</h2>
      <p className="text-muted-foreground">Background Find runs only while this tab is visible. Find Lights always works manually.</p>
      <label>Background interval<br/><select className={inputClass} value={draft.findIntervalSeconds} onChange={(event) => change({ findIntervalSeconds: Number(event.target.value) as 0 | 30 | 60 | 120 })}>
        <option value={60}>60 seconds</option><option value={30}>30 seconds</option><option value={120}>120 seconds</option><option value={0}>Off</option>
      </select></label></section>
    <section className="space-y-3 rounded-lg border border-border bg-card p-5"><h2 className="text-lg">Backups</h2>
      <p className="text-muted-foreground">Retention is Off by default. Storage remains fail-closed at 100 files. View, download, and clear exact copies on the <Link className="underline" href="/backups">Backups page</Link>.</p>
      <label className="flex items-center gap-2"><input type="checkbox" checked={draft.backupRetention.enabled} onChange={(event) => change({ backupRetention: { ...draft.backupRetention, enabled: event.target.checked } })} />Oldest-first retention</label>
      <label>Keep up to<br/><input className={inputClass} type="number" min={1} max={100} value={draft.backupRetention.limit} onChange={(event) => change({ backupRetention: { ...draft.backupRetention, limit: Number(event.target.value) } })}/></label>
      <button className="rounded border border-border px-3 py-2" onClick={() => void previewRotation()}>Preview rotation</button>
      {rotation ? <div role="status" className="text-muted-foreground">{rotation.room ?
        rotation.remove.length ? `Next backup would remove ${rotation.remove.length} eligible older copies:` : "Next backup needs no rotation." :
        "No eligible room: next backup and dependent WLED write will refuse."}
        {rotation.remove.length ? <ul className="mt-2 list-inside list-disc">{rotation.remove.map((item) =>
          <li key={item.id}>{item.id} · {new Date(item.at).toLocaleString()}</li>)}</ul> : null}</div> : null}
    </section>
    <section className="space-y-3 rounded-lg border border-border bg-card p-5"><h2 className="text-lg">WLED across Lights</h2>
      <p className="text-muted-foreground">Read each Light’s own fresh cfg.json, MAC and firmware. Bulk configuration review and Apply are not available yet; no upload is sent from this page. WLED excludes passwords from exports.</p>
      {lights.map((light) => <p key={light.id} className="flex flex-wrap items-center gap-3"><Link className="underline" href={`/lights/${light.id}?tab=settings`}>{light.name} — Light Settings</Link>
        <button className="rounded border border-border px-3 py-1" onClick={() => void loadConfig(light.id)}>Read configuration</button></p>)}
      {configRead ? <details className="rounded border border-border p-3"><summary>Fresh {lights.find((light) => light.id === configRead.lightId)?.name ?? "Light"} configuration · {configRead.firmware} · MAC {configRead.mac}</summary>
        <p className="mt-2 break-all font-mono text-xs">Source digest: {configRead.sourceDigest}</p>
        <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(configRead.config, null, 2)}</pre>
      </details> : null}
    </section>
    <div className="flex items-center gap-3 pb-8"><button className="rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50" disabled={busy} onClick={save}>Save preferences</button>
      <button className="rounded border border-border px-4 py-2" onClick={reload}>Reload</button>
      <span role="status" className="text-muted-foreground">{notice}</span></div>
  </div>;
}
