"use client";

import type { BackupDocument, BackupSummary, LightView } from "@nightplot/shared";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LedLoader } from "@/components/ui/led-loader";
import { deleteJson, fetchJson, postJson } from "@/lib/api";

type RestoreCheck = {
  backup: { id: string; at: string; reason: string; lights: number; segments: number; products: number; activity: number };
  current: { lights: number; segments: number; products: number; activity: number };
  expectedDigest: string;
  expectedCurrentDigest: string;
};

type WledRestoreCheck = {
  ok: boolean;
  message: string;
  macMatch: boolean;
  firmwareMatch: boolean;
  requiresFirmwareConfirm: boolean;
  lightId: string;
  lightName: string;
  captured: { mac: string | null; firmware: string | null; host: string | null; capturedAt: string | null };
  live: { mac: string | null; firmware: string | null; host: string };
};

export function BackupsPanel({ initial, lights = [] }: { initial: BackupSummary[]; lights?: LightView[] }) {
  const [backups, setBackups] = useState(initial);
  const [selected, setSelected] = useState<BackupDocument | null>(null);
  const [review, setReview] = useState<RestoreCheck | null>(null);
  const [clearId, setClearId] = useState<string | null>(null);
  const [typedId, setTypedId] = useState("");
  const [deviceLightId, setDeviceLightId] = useState("");
  const [wledReview, setWledReview] = useState<WledRestoreCheck | null>(null);
  const [confirmFirmware, setConfirmFirmware] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function reload() {
    const result = await fetchJson<{ backups: BackupSummary[] }>("/api/backups");
    setBackups(result.backups);
  }

  async function run(label: string, action: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try { await action(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Backup action failed. Check Nightplot before retrying."); }
    finally { setBusy(null); }
  }

  function resetReview() {
    setReview(null);
    setWledReview(null);
    setConfirmFirmware(false);
    setClearId(null);
    setTypedId("");
  }

  async function create() {
    await run("Creating backup…", async () => {
      const res = await postJson<{ backup: BackupDocument }>("/api/backups", {});
      if (!res.ok) throw new Error(res.data.message ?? "Backup could not be saved.");
      await reload();
      setSelected(res.data.backup);
      resetReview();
      setNotice("Nightplot data backup saved. No controller was changed.");
    });
  }

  async function createDevice() {
    if (!deviceLightId) return;
    await run("Backing up WLED…", async () => {
      const res = await postJson<{ backup: BackupDocument }>(`/api/lights/${deviceLightId}/backups`, {});
      if (!res.ok) throw new Error(res.data.message ?? "WLED backup was not saved.");
      await reload(); setSelected(res.data.backup); resetReview();
      setNotice("WLED configuration and presets saved with Nightplot data. Passwords are excluded. Treat the files as private. This is not Hardware Done.");
    });
  }

  async function open(id: string) {
    await run("Opening backup…", async () => {
      const result = await fetchJson<{ backup: BackupDocument }>(`/api/backups/${id}`);
      setSelected(result.backup);
      resetReview();
      setNotice(null);
    });
  }

  function downloadFile(content: string, name: string) {
    const blob = new Blob([content], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = name;
    document.body.append(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function download() {
    if (!selected) return;
    downloadFile(`${JSON.stringify(selected, null, 2)}\n`, `nightplot-backup-${selected.id}.json`);
  }

  async function checkRestore() {
    if (!selected) return;
    await run("Reviewing restore…", async () => {
      const res = await postJson<RestoreCheck>(`/api/backups/${selected.id}/restore/check`, {});
      if (!res.ok) throw new Error(res.data.message ?? "Backup cannot be restored.");
      setReview(res.data);
      setClearId(null);
      setTypedId("");
    });
  }

  async function checkWledRestore() {
    if (!selected?.deviceFiles) return;
    const lightId = deviceLightId || selected.lightId;
    if (!lightId) {
      setError("Choose the Light that should receive these WLED files.");
      return;
    }
    await run("Reviewing WLED restore…", async () => {
      const res = await postJson<WledRestoreCheck>(`/api/backups/${selected.id}/restore-wled/check`, { lightId });
      if (!res.ok) throw new Error(res.data.message ?? "This WLED export cannot be uploaded.");
      setWledReview(res.data);
      setReview(null);
      setClearId(null);
      setTypedId("");
      setConfirmFirmware(false);
    });
  }

  async function restoreWled() {
    if (!selected || !wledReview || typedId !== selected.id) return;
    if (wledReview.requiresFirmwareConfirm && !confirmFirmware) return;
    await run("Uploading WLED files…", async () => {
      const res = await postJson<{ safetyBackupId: string; message: string }>(
        `/api/backups/${selected.id}/restore-wled`,
        { lightId: wledReview.lightId, confirmId: selected.id,
          confirmFirmwareMismatch: confirmFirmware },
      );
      if (!res.ok) { resetReview(); throw new Error(res.data.message ?? "WLED files were not uploaded."); }
      await reload();
      resetReview();
      setNotice(`${res.data.message} Safety backup: ${res.data.safetyBackupId}.`);
    });
  }

  async function restore() {
    if (!selected || !review || typedId !== selected.id) return;
    await run("Restoring Nightplot data…", async () => {
      const res = await postJson<{ safetyBackupId: string; message: string }>(
        `/api/backups/${selected.id}/restore`,
        { confirmId: selected.id, expectedDigest: review.expectedDigest,
          expectedCurrentDigest: review.expectedCurrentDigest },
      );
      if (!res.ok) { resetReview(); throw new Error(res.data.message ?? "Restore did not finish. Review again."); }
      await reload();
      resetReview();
      setNotice(`${res.data.message} Safety backup: ${res.data.safetyBackupId}. Reload Lights to see restored data.`);
    });
  }

  async function clear() {
    if (!selected || clearId !== selected.id || typedId !== selected.id) return;
    await run("Clearing backup…", async () => {
      const res = await deleteJson(`/api/backups/${selected.id}`, { confirmId: selected.id });
      if (!res.ok) throw new Error(res.data.message ?? "Backup was not cleared.");
      setSelected(null);
      resetReview();
      await reload();
      setNotice("Backup cleared from local storage. It cannot be recovered unless you downloaded a copy.");
    });
  }

  return <div className="mx-auto flex w-full max-w-[1050px] flex-col gap-5 px-5 py-7 sm:px-10">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-[28px] font-semibold">Backups</h1>
        <p className="text-[13px] text-muted-foreground">Each backup contains Nightplot data. A WLED backup also includes that Light’s native configuration and presets files. Passwords are not included. Treat exports as private. This is not whole-device recovery and not Hardware Done.</p></div>
      <Button disabled={busy !== null} onClick={() => void create()}>Back up Nightplot now</Button>
    </header>
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-[13px]">Light for device backup
        <select className="mt-1 block rounded-lg border border-border bg-card p-2" value={deviceLightId} onChange={(event) => setDeviceLightId(event.target.value)}>
          <option value="">Choose a Light</option>
          {lights.map((light) => <option key={light.id} value={light.id}>{light.name}</option>)}
        </select>
      </label>
      <Button variant="outline" disabled={busy !== null || !deviceLightId} onClick={() => void createDevice()}>Back up WLED</Button>
    </div>
    {lights.length > 0 ? <section aria-label="Per-Light WLED exports" className="rounded-xl border border-border bg-card p-4">
      <h2 className="font-medium">Per-Light WLED exports</h2>
      <ul className="mt-2 space-y-1 text-[13px]">{lights.map((light) => {
        const rows = backups.filter((item) => item.lightId === light.id);
        const complete = rows.find((item) => item.hasDeviceFiles || item.deviceCaptureStatus === "complete");
        const incomplete = rows.find((item) => item.deviceCaptureStatus === "incomplete");
        return <li key={light.id}>{complete
          ? `${light.name} — complete configuration + presets · ${new Date(complete.at).toLocaleString()}`
          : incomplete
            ? `${light.name} — incomplete: ${incomplete.deviceCaptureError || "native files were not saved"}`
            : `${light.name} — no complete WLED configuration + presets`}</li>;
      })}</ul>
    </section> : null}
    {busy ? <LedLoader label={busy} /> : null}
    {error ? <p role="alert" className="text-destructive">{error}</p> : null}
    {notice ? <p role="status" className="text-online">{notice}</p> : null}
    <p className="text-[12px] text-muted-foreground">Before Apply, Strip provision and Safe settings, Nightplot saves both WLED export files plus Nightplot data or refuses the write. Before Delete, replacement and LED product changes, it saves Nightplot data. Preview, Blink and All Off do not create automatic backups. Up to 100 backups are kept; download or clear older ones to make room.</p>
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <section aria-label="Saved backups" className="rounded-xl border border-border bg-card p-4">
        <h2 className="font-medium">Saved backups ({backups.length})</h2>
        {backups.length === 0 ? <p className="mt-3 text-muted-foreground">No backups yet.</p> : null}
        <ul className="mt-2 max-h-[540px] space-y-1 overflow-auto">{backups.map((item) => <li key={item.id}>
          <button type="button" onClick={() => void open(item.id)} disabled={busy !== null}
            className="w-full rounded-lg border border-border p-3 text-left hover:bg-secondary">
            <span className="block font-medium">{item.reason.replaceAll("-", " ")}{item.lightName ? ` · ${item.lightName}` : ""}</span>
            <span className="text-[12px] text-muted-foreground">{new Date(item.at).toLocaleString()} · {item.lightCount} Lights · {item.segmentCount} Segments {item.hasDeviceFiles || item.deviceCaptureStatus === "complete" ? "· WLED configuration + presets" : item.deviceCaptureStatus === "incomplete" ? "· WLED export incomplete" : item.hasControllerReference ? "· controller reference only" : "· Nightplot data only"}{item.deviceFirmware ? ` · ${item.deviceFirmware}` : ""}</span>
          </button>
        </li>)}</ul>
      </section>
      <section aria-label="Backup details" className="rounded-xl border border-border bg-card p-4">
        <h2 className="font-medium">Details</h2>
        {!selected ? <p className="mt-3 text-muted-foreground">Select a backup to inspect, download, restore or clear it.</p> : <div className="mt-3 flex flex-col gap-3 text-[13px]">
          <p>{selected.reason.replaceAll("-", " ")} · {new Date(selected.at).toLocaleString()}</p>
          <p>{selected.data.lights.length} Lights · {selected.data.elements.length} Segments · {selected.data.products.length} LED products · {selected.data.activity.length} Activity entries</p>
          <p className="font-mono text-[11px] break-all text-muted-foreground">ID: {selected.id}</p>
          {selected.controller ? <details className="rounded-lg border border-border p-3">
            <summary className="cursor-pointer">Controller reference: {selected.controller.hostKey} · MAC {selected.controller.mac ?? "unknown"} · {selected.controller.ledCount} LEDs</summary>
            <p className="mt-2 text-muted-foreground">Reported fields may be incomplete. This cannot be replayed as a full WLED restore.</p>
            <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-all text-[11px]">{JSON.stringify(selected.controller, null, 2)}</pre>
          </details> : null}
          {selected.deviceFiles ? <div className="rounded-lg border border-border p-3 space-y-2">
            <p>WLED configuration and presets are both saved as opaque files. Passwords are excluded. This is not a firmware backup and not Hardware Done. Treat the files as private.</p>
            <p className="text-muted-foreground">Light {selected.deviceFiles.lightId ?? selected.lightId ?? "unknown"} · {selected.deviceFiles.host ?? selected.controller?.hostKey ?? "host unknown"} · MAC {selected.deviceFiles.mac ?? selected.controller?.mac ?? "unknown"} · {selected.deviceFiles.firmware ?? "firmware unknown"} · captured {selected.deviceFiles.capturedAt ?? selected.at}</p>
            {selected.deviceFiles.secretsRemoved ? <p>Leftover passwords were removed before saving.</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => downloadFile(selected.deviceFiles!.cfgJson, `wled-cfg-${selected.id}.json`)}>Download WLED configuration</Button>
              <Button variant="outline" onClick={() => downloadFile(selected.deviceFiles!.presetsJson, `wled-presets-${selected.id}.json`)}>Download WLED presets</Button>
            </div>
          </div> : <p className="text-muted-foreground">{selected.deviceCaptureStatus === "incomplete"
            ? `WLED export incomplete: ${selected.deviceCaptureError || "native files were not saved"}. Nightplot data in this backup is still valid. A small cfg/state reference is not a device backup.`
            : "No complete WLED configuration + presets in this backup. A small cfg/state reference is not a device backup."}</p>}
          <ul className="text-muted-foreground">{selected.data.lights.map((light) => <li key={light.id}>{light.name} · {light.hostname}:{light.port}</li>)}</ul>
          <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={download}>Download JSON</Button>
            <Button variant="outline" disabled={busy !== null} onClick={() => void checkRestore()}>Review Nightplot restore</Button>
            <Button variant="outline" disabled={busy !== null || !selected.deviceFiles} onClick={() => void checkWledRestore()}>Review WLED restore</Button>
            <Button variant="outline" disabled={busy !== null} onClick={() => { setClearId(selected.id); setReview(null); setWledReview(null); setTypedId(""); }}>Clear backup…</Button></div>
          {review ? <div className="space-y-3 rounded-lg border border-primary/50 p-3">
            <p>Restore: {review.backup.lights} Lights, {review.backup.segments} Segments, {review.backup.products} products, {review.backup.activity} Activity entries.</p>
            <p>Current: {review.current.lights} Lights, {review.current.segments} Segments, {review.current.products} products, {review.current.activity} Activity entries.</p>
            <p className="text-muted-foreground">All current Nightplot data will be replaced. A safety backup is saved first. Nothing is Applied to WLED.</p>
            <label className="block">Type the full backup ID to restore<Input className="mt-1 font-mono" aria-label="Confirm backup ID" value={typedId} onChange={(event) => setTypedId(event.target.value)} /></label>
            <Button disabled={busy !== null || typedId !== selected.id} onClick={() => void restore()}>Restore Nightplot data</Button>
          </div> : null}
          {wledReview ? <div className="space-y-3 rounded-lg border border-primary/50 p-3">
            <p>Upload configuration and presets to {wledReview.lightName}. Nightplot data is not changed. This is not Apply.</p>
            <p>Saved MAC {wledReview.captured.mac ?? "unknown"} · live MAC {wledReview.live.mac ?? "unknown"}{wledReview.macMatch ? " · match" : ""}</p>
            <p>Saved firmware {wledReview.captured.firmware ?? "unknown"} · live firmware {wledReview.live.firmware ?? "unknown"}</p>
            <p className="text-muted-foreground">{wledReview.message}</p>
            {wledReview.requiresFirmwareConfirm ? <label className="flex items-center gap-2">
              <input type="checkbox" checked={confirmFirmware} onChange={(event) => setConfirmFirmware(event.target.checked)} />
              Firmware differs. Upload these files anyway.
            </label> : null}
            <label className="block">Type the full backup ID to upload WLED files<Input className="mt-1 font-mono" aria-label="Confirm WLED backup ID" value={typedId} onChange={(event) => setTypedId(event.target.value)} /></label>
            <Button disabled={busy !== null || typedId !== selected.id || (wledReview.requiresFirmwareConfirm && !confirmFirmware)} onClick={() => void restoreWled()}>Upload WLED files</Button>
          </div> : null}
          {clearId === selected.id ? <div className="space-y-3 rounded-lg border border-destructive/50 p-3">
            <p>Clearing this backup cannot be undone. Download it first if you need a copy.</p>
            <label className="block">Type the full backup ID to clear<Input className="mt-1 font-mono" aria-label="Confirm backup ID" value={typedId} onChange={(event) => setTypedId(event.target.value)} /></label>
            <Button variant="allOff" disabled={busy !== null || typedId !== selected.id} onClick={() => void clear()}>Clear this backup</Button>
          </div> : null}
        </div>}
      </section>
    </div>
  </div>;
}
