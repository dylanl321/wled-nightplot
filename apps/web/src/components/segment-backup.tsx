"use client";

import {
  backupNeedsControllerConfirmation,
  parseSegmentBackup,
  type LightDetail,
  type SegmentBackup,
} from "@nightplot/shared";
import { useState, type ChangeEvent } from "react";
import { Button } from "@/components/ui/button";
import { fetchJson, postJson } from "@/lib/api";

export function SegmentBackupPanel({ detail, blocked, onRestored }: {
  detail: LightDetail;
  blocked: boolean;
  onRestored: (next: LightDetail) => void;
}) {
  const [backup, setBackup] = useState<SegmentBackup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const different = backup ? backupNeedsControllerConfirmation(backup, detail.light) : false;
  const sameLength = backup?.source.ledCount === detail.light.ledCount;

  async function exportSaved() {
    setBusy(true);
    setError(null);
    try {
      const saved = await fetchJson<SegmentBackup>(`/api/lights/${detail.light.id}/segments/backup`);
      const blob = new Blob([`${JSON.stringify(saved, null, 2)}\n`], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `nightplot-segments-${detail.light.id}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice("Saved Segments downloaded. Unsaved edits are not included.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Backup could not be downloaded.");
    } finally {
      setBusy(false);
    }
  }

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    setBackup(null);
    setNotice(null);
    if (!file) return;
    if (file.size > 64_000) { setError("Backup is too large. Nothing was saved."); return; }
    try {
      const parsed = parseSegmentBackup(JSON.parse(await file.text()));
      if (!parsed) throw new Error("This is not a valid Nightplot Segment backup. Nothing was saved.");
      setBackup(parsed);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not read that backup.");
    }
  }

  async function restore() {
    if (!backup || !sameLength || blocked || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await postJson<LightDetail & { message: string }>(
        `/api/lights/${detail.light.id}/segments/restore`,
        { backup, confirmDifferentController: different },
      );
      if (!res.ok) { setError(res.data.message ?? "Segments were not restored."); return; }
      onRestored(res.data);
      setBackup(null);
      setNotice(res.data.message);
    } catch {
      setError("Could not reach Nightplot. Check the saved Segments before trying again.");
    } finally {
      setBusy(false);
    }
  }

  return <details className="rounded-xl border border-border bg-card px-4 py-3 text-[13px]">
    <summary className="cursor-pointer font-medium">Back up or restore Segments</summary>
    <p className="mt-2 text-muted-foreground">Download the saved layout, or select a backup to review before replacing this Light’s saved Segments. This does not Preview or Apply to the controller.</p>
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <Button variant="outline" onClick={() => void exportSaved()} disabled={busy}>Download saved Segments</Button>
      <label className="flex cursor-pointer items-center gap-2">Choose backup
        <input type="file" accept=".json,application/json" onChange={(event) => void choose(event)} disabled={busy} className="max-w-[220px] text-[12px]" />
      </label>
    </div>
    {notice ? <p role="status" className="mt-2 text-online">{notice}</p> : null}
    {error ? <p role="alert" className="mt-2 text-destructive">{error}</p> : null}
    {backup ? <div className="mt-3 space-y-2 rounded-lg border border-border p-3">
      <p>From {backup.source.lightName} · {backup.source.ledCount} LEDs · {backup.segments.length} Segments</p>
      {!sameLength ? <p className="text-destructive">This Light has {detail.light.ledCount} LEDs. Match the strip length before restoring; nothing will be replaced.</p> : null}
      {different ? <p className="text-destructive">Different controller: confirm that {detail.light.name} is the intended target. This does not transfer its settings or address.</p> : null}
      <ul className="max-h-36 overflow-auto text-muted-foreground">{backup.segments.map((segment, index) =>
        <li key={index}>{segment.label} ({segment.start}–{segment.stop})</li>)}</ul>
      {backup.segments.length === 0 ? <p className="text-destructive">This backup has no Segments; restoring it clears the saved layout.</p> : null}
      {blocked ? <p className="text-destructive">Save or discard unsaved edits and end Preview before restoring.</p> : null}
      <Button onClick={() => void restore()} disabled={blocked || !sameLength || busy}>
        {different ? `Confirm restore to ${detail.light.name}` : `Restore saved Segments to ${detail.light.name}`}
      </Button>
    </div> : null}
  </details>;
}
