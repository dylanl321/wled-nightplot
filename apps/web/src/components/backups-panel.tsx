"use client";

import {
  CONTROLLER_CAPTURE_CAPTION,
  RESTORE_NIGHTPLOT_CAPTION,
  type NightplotBackupDiff,
  type NightplotBackupMeta,
} from "@nightplot/shared";
import { useState } from "react";
import { GlowingLedLoader } from "@/components/glowing-led-loader";
import { Button } from "@/components/ui/button";
import { deleteJson, fetchJson, postJson } from "@/lib/api";

type BackupDetails = {
  lights: { id: string; name: string; ledCount: number; host: string; segments: number }[];
  ledProducts: { id: string; label: string }[];
  activityCount: number;
  controller: {
    lightId: string;
    lightName: string;
    host: string;
    missing: string[];
    capturedAt: string;
  } | null;
  incomplete: string[];
  restoreCaption?: string;
  controllerCaption?: string | null;
};

export function BackupsPanel({
  initialBackups = [],
  skippedInvalid = 0,
  restoreCaption,
  controllerCaption,
  loadError,
}: {
  initialBackups?: NightplotBackupMeta[];
  skippedInvalid?: number;
  restoreCaption?: string;
  controllerCaption?: string;
  loadError?: string;
}) {
  const [backups, setBackups] = useState(initialBackups);
  const [invalidCount, setInvalidCount] = useState(skippedInvalid);
  const [selectedId, setSelectedId] = useState<string | null>(initialBackups[0]?.id ?? null);
  const [details, setDetails] = useState<BackupDetails | null>(null);
  const [diff, setDiff] = useState<NightplotBackupDiff | null>(null);
  const [busy, setBusy] = useState<"load" | "create" | "details" | "diff" | "restore" | "delete" | "download" | null>(
    null,
  );
  const [notice, setNotice] = useState<string | null>(loadError ?? null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [restoreConfirm, setRestoreConfirm] = useState(false);

  const selected = backups.find((row) => row.id === selectedId) ?? null;

  async function reload() {
    setBusy("load");
    setNotice(null);
    try {
      const payload = await fetchJson<{
        backups: NightplotBackupMeta[];
        skippedInvalid?: number;
      }>("/api/backups");
      setBackups(payload.backups ?? []);
      setInvalidCount(payload.skippedInvalid ?? 0);
      setSelectedId((current) => {
        if (current && payload.backups.some((row) => row.id === current)) return current;
        return payload.backups[0]?.id ?? null;
      });
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Backups could not be loaded.");
    }
    setBusy(null);
  }

  async function createBackup() {
    setBusy("create");
    setNotice(null);
    const res = await postJson<{ backup?: NightplotBackupMeta }>("/api/backups", {});
    setBusy(null);
    if (!res.ok) {
      setNotice(res.data.message ?? "Could not save a Nightplot backup.");
      return;
    }
    if (res.data.backup) {
      setBackups((current) => [res.data.backup!, ...current.filter((row) => row.id !== res.data.backup!.id)]);
      setSelectedId(res.data.backup.id);
      setDetails(null);
      setDiff(null);
      setDeleteConfirm(false);
      setRestoreConfirm(false);
    }
  }

  async function loadDetails(id: string) {
    setBusy("details");
    setNotice(null);
    setDiff(null);
    setDeleteConfirm(false);
    setRestoreConfirm(false);
    try {
      const payload = await fetchJson<{ details: BackupDetails }>(`/api/backups/${id}`);
      setDetails(payload.details);
    } catch (caught) {
      setDetails(null);
      setNotice(caught instanceof Error ? caught.message : "That backup could not be opened.");
    }
    setBusy(null);
  }

  async function loadDiff(id: string) {
    setBusy("diff");
    setNotice(null);
    try {
      const payload = await fetchJson<{ diff: NightplotBackupDiff }>(`/api/backups/${id}/diff`);
      setDiff(payload.diff);
    } catch (caught) {
      setDiff(null);
      setNotice(caught instanceof Error ? caught.message : "Could not compare that backup.");
    }
    setBusy(null);
  }

  async function download(id: string) {
    setBusy("download");
    setNotice(null);
    try {
      const res = await fetch(`/api/backups/${id}/download`, { headers: { Accept: "application/json" } });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? "Download failed.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `nightplot-data-${id}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Download failed.");
    }
    setBusy(null);
  }

  async function remove(id: string) {
    if (!deleteConfirm) return;
    setBusy("delete");
    setNotice(null);
    const res = await deleteJson<{ message?: string }>(`/api/backups/${id}`, { confirm: true });
    setBusy(null);
    if (!res.ok) {
      setNotice(res.data.message ?? "That backup was not removed.");
      return;
    }
    setBackups((current) => current.filter((row) => row.id !== id));
    setSelectedId((current) => {
      if (current !== id) return current;
      const next = backups.find((row) => row.id !== id);
      return next?.id ?? null;
    });
    setDetails(null);
    setDiff(null);
    setDeleteConfirm(false);
    setRestoreConfirm(false);
  }

  async function restore(id: string) {
    if (!restoreConfirm || !diff) return;
    setBusy("restore");
    setNotice(null);
    const res = await postJson<{ message?: string }>(`/api/backups/${id}/restore`, { confirm: true });
    setBusy(null);
    if (!res.ok) {
      setNotice(res.data.message ?? "Restore did not run.");
      return;
    }
    setNotice(res.data.message ?? "Restored Nightplot data. Nothing was sent to a controller.");
    setRestoreConfirm(false);
    await reload();
  }

  return (
    <div className="mx-auto flex w-full max-w-[860px] flex-1 flex-col gap-6 px-5 py-8 sm:px-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-[26px] font-semibold tracking-[-0.01em]">Backups</h1>
        <p className="text-muted-foreground">
          Versioned copies of Nightplot Lights, Segments, LED products, and Activity.
          Restore replaces Nightplot data only — it does not Apply to a controller.
        </p>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-border bg-[#0e1014] p-4">
        <p className="text-[13px] leading-5 text-[#c9c3b8]">
          {restoreCaption ?? RESTORE_NIGHTPLOT_CAPTION}
        </p>
        <p className="text-[13px] leading-5 text-[#c9c3b8]">
          {controllerCaption ?? CONTROLLER_CAPTURE_CAPTION}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => void createBackup()} disabled={busy !== null}>
            Save Nightplot backup
          </Button>
          <Button variant="outline" onClick={() => void reload()} disabled={busy !== null}>
            Refresh
          </Button>
          {busy ? <GlowingLedLoader label={busyLabel(busy)} /> : null}
        </div>
      </div>

      {notice ? <p role="alert" className="text-[13px] text-destructive">{notice}</p> : null}
      {invalidCount > 0 ? (
        <p className="text-[13px] text-primary">
          {invalidCount} file{invalidCount === 1 ? "" : "s"} on the data volume could not be read as a Nightplot backup.
        </p>
      ) : null}

      {backups.length === 0 && !busy ? (
        <p className="text-muted-foreground">No Nightplot backups yet. Save one here, or they appear before Apply, Strip Apply, Safe settings, catalog changes, and Remove.</p>
      ) : null}

      <ol className="divide-y divide-border rounded-xl border border-border">
        {backups.map((row) => (
          <li key={row.id}>
            <button
              type="button"
              className={`flex w-full flex-col gap-1 px-4 py-3 text-left ${row.id === selectedId ? "bg-secondary/70" : "hover:bg-secondary/40"}`}
              onClick={() => {
                setSelectedId(row.id);
                setDetails(null);
                setDiff(null);
                setDeleteConfirm(false);
                setRestoreConfirm(false);
                void loadDetails(row.id);
              }}
            >
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{row.reasonLabel}</span>
                <span className="text-muted-foreground">{new Date(row.createdAt).toLocaleString()}</span>
                <span className="ml-auto text-[12px] text-muted-foreground">
                  {row.completeness === "partial" ? "Partial" : "Complete"}
                </span>
              </span>
              <span className="text-[13px] text-muted-foreground">
                {row.counts.lights} Lights · {row.counts.elements} Segments · {row.counts.ledProducts} LED products · {row.counts.activity} Activity
                {row.note ? ` · ${row.note}` : ""}
              </span>
            </button>
          </li>
        ))}
      </ol>

      {selected ? (
        <section className="flex flex-col gap-4 rounded-[14px] border border-border bg-card p-5" aria-label="Backup details">
          <div>
            <h2 className="text-lg font-medium">{selected.reasonLabel}</h2>
            <p className="text-[13px] text-muted-foreground">{new Date(selected.createdAt).toLocaleString()}</p>
          </div>
          {selected.completeness === "partial" ? (
            <p className="text-[13px] text-primary">{selected.incomplete.join(" ")}</p>
          ) : null}
          {details ? (
            <div className="flex flex-col gap-2 text-[13px]">
              {details.lights.length === 0 ? <p className="text-muted-foreground">No Lights in this backup.</p> : null}
              {details.lights.map((light) => (
                <p key={light.id} className="text-muted-foreground">
                  {light.name} · {light.ledCount} LEDs · {light.segments} Segments · {light.host}
                </p>
              ))}
              <p className="text-muted-foreground">
                {details.ledProducts.length} LED products · {details.activityCount} Activity
              </p>
              {details.controller ? (
                <p className="text-muted-foreground">
                  Controller reference for {details.controller.lightName} ({details.controller.host})
                  {details.controller.missing.length
                    ? ` — missing ${details.controller.missing.join(" and ")}`
                    : ""}
                  . Download only — not restored to the box.
                </p>
              ) : null}
            </div>
          ) : (
            <Button variant="outline" onClick={() => void loadDetails(selected.id)} disabled={busy !== null}>
              View details
            </Button>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void download(selected.id)} disabled={busy !== null}>
              Download
            </Button>
            <Button variant="outline" onClick={() => void loadDiff(selected.id)} disabled={busy !== null}>
              Review restore
            </Button>
          </div>
          {diff ? (
            <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
              <p className="text-[13px] leading-5 text-[#c9c3b8]">{diff.summary}</p>
              <label className="flex items-start gap-2 text-[13px]">
                <input
                  type="checkbox"
                  checked={restoreConfirm}
                  onChange={(event) => setRestoreConfirm(event.target.checked)}
                />
                <span>Restore Nightplot data from this backup. Nothing will be sent to a controller.</span>
              </label>
              <Button onClick={() => void restore(selected.id)} disabled={!restoreConfirm || busy !== null}>
                Restore Nightplot data
              </Button>
            </div>
          ) : null}
          <div className="flex flex-col gap-2 rounded-lg border border-[#3a4150] p-3">
            <label className="flex items-start gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={deleteConfirm}
                onChange={(event) => setDeleteConfirm(event.target.checked)}
              />
              <span>Delete this backup from Nightplot. This does not change any controller.</span>
            </label>
            <Button
              variant="outline"
              className="border-destructive text-destructive hover:bg-[#1a1113]"
              onClick={() => void remove(selected.id)}
              disabled={!deleteConfirm || busy !== null}
            >
              Delete backup
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function busyLabel(busy: "load" | "create" | "details" | "diff" | "restore" | "delete" | "download"): string {
  switch (busy) {
    case "load":
      return "Loading backups";
    case "create":
      return "Saving backup";
    case "details":
      return "Opening backup";
    case "diff":
      return "Comparing backup";
    case "restore":
      return "Restoring Nightplot data";
    case "delete":
      return "Deleting backup";
    case "download":
      return "Preparing download";
  }
}
