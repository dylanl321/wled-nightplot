"use client";

import {
  BLINK_PULSE_MS,
  SEASON_CAPTION,
  YARD_CAPTION,
  type LightView,
  type SeasonDiff,
  type SyncResult,
  type YardCheckResult,
  type YardCheckRow,
  type YardCompareStatus,
  type YardUndoToken,
} from "@nightplot/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { fetchJson, postJson } from "@/lib/api";
import { lastSeenLabel } from "@/lib/time";
import { cn } from "@/lib/utils";

type SeasonReview = {
  ok: boolean;
  migratedFrom: string;
  incoming: { lights: number; segments: number; props: number; profiles: number; looks: number | null };
  current: { lights: number; segments: number; props: number; profiles: number; looks: number | null };
  diff: SeasonDiff;
  expectedDigest: string;
  expectedCurrentDigest: string;
  looksMissing: boolean;
  hostCollision?: boolean;
  message: string;
  document?: unknown;
};

const STATUS_COPY: Record<YardCompareStatus, string> = {
  match: "Match",
  mismatch: "Differs",
  unknown: "Unknown",
  "not-pushed": "Not pushed",
};

const FIX_COPY: Record<SyncResult["rows"][number]["status"], string> = {
  matched: "Matched",
  mismatch: "Differs",
  unknown: "Unknown",
  failed: "Failed",
  refused: "Not sent",
};

export function YardPanel({
  lights,
  initial = null,
}: {
  lights: LightView[];
  initial?: (YardCheckResult & { undo?: YardUndoToken | null }) | null;
}) {
  const [check, setCheck] = useState<YardCheckResult | null>(initial);
  const [undo, setUndo] = useState<YardUndoToken | null>(initial?.undo ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [includeDevices, setIncludeDevices] = useState(false);
  const [review, setReview] = useState<(SeasonReview & { document: unknown }) | null>(null);
  const [pushOnRestore, setPushOnRestore] = useState(false);
  const router = useRouter();

  async function run(label: string, work: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try { await work(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Yard did not finish. Check each Light before retrying."); }
    finally { setBusy(null); }
  }

  async function loadCheck() {
    const payload = await fetchJson<YardCheckResult & { undo?: YardUndoToken | null }>("/api/yard-check");
    setCheck(payload);
    setUndo(payload.undo ?? null);
  }

  async function blink(row: YardCheckRow) {
    await run(`Blinking ${row.name}…`, async () => {
      const started = await postJson(`/api/lights/${row.lightId}/blink`, {});
      if (!started.ok) throw new Error(started.data.message ?? "Blink did not run.");
      await new Promise<void>((resolve) => window.setTimeout(resolve, BLINK_PULSE_MS));
      const ended = await postJson(`/api/lights/${row.lightId}/blink/end`, {});
      if (!ended.ok) throw new Error(ended.data.message ?? "Blink could not restore this Light.");
      setNotice(`Blink finished on ${row.name}.`);
    });
  }

  async function fix(lightIds?: string[]) {
    await run(lightIds ? "Fixing this Light…" : "Fixing drift…", async () => {
      const res = await postJson<SyncResult & { undo?: YardUndoToken | null }>("/api/yard-check/fix", lightIds ? { lightIds } : {});
      if (!res.ok) throw new Error(res.data.message ?? "Fix was not sent.");
      setResult(res.data);
      setUndo(res.data.undo ?? null);
      setNotice(null);
      await loadCheck();
    });
  }

  async function sweep() {
    await run("Sweeping the yard…", async () => {
      const res = await postJson<SyncResult>("/api/yard-check/sweep", {});
      if (!res.ok) throw new Error(res.data.message ?? "Sweep was not sent.");
      setResult(res.data);
      setNotice(null);
      await loadCheck();
    });
  }

  async function undoFix() {
    await run("Undoing last fix…", async () => {
      const res = await postJson<SyncResult>("/api/yard-check/undo", {});
      if (!res.ok) throw new Error(res.data.message ?? "Undo was not sent.");
      setResult(res.data);
      setUndo(null);
      setNotice(null);
      await loadCheck();
    });
  }

  async function saveSeason() {
    await run("Saving season…", async () => {
      const payload = await fetchJson<{ document: unknown }>(`/api/season/export${includeDevices ? "?includeDevices=1" : ""}`);
      const blob = new Blob([JSON.stringify(payload.document, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "nightplot-season.json";
      link.click();
      URL.revokeObjectURL(url);
      setNotice("Season file downloaded. Treat it as private if it includes WLED files.");
    });
  }

  async function chooseSeason(file: File) {
    await run("Reading season file…", async () => {
      const text = await file.text();
      let document: unknown;
      try { document = JSON.parse(text); }
      catch { throw new Error("That file is not JSON. Nothing was restored."); }
      const res = await postJson<SeasonReview>("/api/season/review", { document });
      if (!res.ok) throw new Error(res.data.message ?? "Season file was not accepted.");
      setReview({ ...res.data, document });
      setNotice(null);
    });
  }

  async function restoreSeason() {
    if (!review) return;
    await run("Restoring season…", async () => {
      const res = await postJson<SyncResult & { message: string }>("/api/season/restore", {
        document: review.document,
        expectedDigest: review.expectedDigest,
        expectedCurrentDigest: review.expectedCurrentDigest,
        confirm: true,
        pushToControllers: pushOnRestore,
      });
      if (!res.ok) throw new Error(res.data.message ?? "Season was not restored.");
      setResult("rows" in res.data ? res.data : null);
      setReview(null);
      setNotice(res.data.message);
      await loadCheck();
      router.refresh();
    });
  }

  const drifted = check?.rows.filter((row) => row.canFix) ?? [];
  const disabled = Boolean(busy);

  if (lights.length === 0) {
    return (
      <section className="flex flex-1 flex-col gap-4 px-5 py-8">
        <h1 className="text-[26px] font-semibold">Yard check</h1>
        <p className="text-[15px] leading-6 text-muted-foreground">Connect a controller first. Then this page compares what you saved with what the controller reports.</p>
        <Button asChild size="lg" className="min-h-12">
          <Link href="/discover">Connect controllers</Link>
        </Button>
      </section>
    );
  }

  return (
    <section className="flex flex-1 flex-col gap-6 px-5 py-8 sm:px-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-[26px] font-semibold tracking-[-0.01em]">Yard check</h1>
        <p className="text-[15px] leading-6">
          Checks that each controller still has the lights you saved, and fixes any that drifted. To place props, use{" "}
          <Link href="/" className="underline underline-offset-4">Your yard</Link>.
        </p>
        <p className="text-[14px] text-muted-foreground">{YARD_CAPTION}</p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Button disabled={disabled} onClick={() => void run("Checking the yard…", loadCheck)}>Check yard</Button>
        <Button variant="outline" disabled={disabled || lights.length === 0} onClick={() => void sweep()}>Sweep</Button>
        <Button disabled={disabled || drifted.length === 0} onClick={() => void fix()}>Fix all drift</Button>
        <Button variant="outline" disabled={disabled || !undo} onClick={() => void undoFix()}>Undo</Button>
      </div>
      {busy ? <p className="text-[14px] text-muted-foreground">{busy}</p> : null}
      {notice ? <p className="text-[14px]">{notice}</p> : null}
      {error && !review ? <p className="text-[14px] text-destructive">{error}</p> : null}

      {check && check.rows.length === 0 ? (
        <p className="text-[14px] text-muted-foreground">Enroll Lights first. Season save can still keep Looks and profiles.</p>
      ) : null}

      <ul className="flex flex-col gap-3">
        {(check?.rows ?? []).map((row) => (
          <li key={row.lightId} className="rounded-[14px] border border-border p-4">
            <YardRow row={row} disabled={disabled} onBlink={() => void blink(row)} onFix={() => void fix([row.lightId])} />
          </li>
        ))}
      </ul>

      {result?.rows?.length ? (
        <div className="flex flex-col gap-2">
          <h2 className="text-[16px] font-medium">Last action</h2>
          <p className="text-[14px]">{result.message}</p>
          <ul className="text-[14px]">
            {result.rows.map((row) => (
              <li key={row.lightId}>{row.lightName} · {FIX_COPY[row.status]} · {row.detail}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 border-t border-border pt-5">
        <h2 className="text-[16px] font-medium">Season</h2>
        <p className="text-[13px] text-muted-foreground">{SEASON_CAPTION}</p>
        <label className="flex items-center gap-2 text-[14px]">
          <input type="checkbox" checked={includeDevices} onChange={(event) => setIncludeDevices(event.target.checked)} />
          <span>Include native WLED cfg/presets when a Light answers</span>
        </label>
        <div className="flex flex-wrap gap-3">
          <Button variant="outline" disabled={disabled} onClick={() => void saveSeason()}>Save season</Button>
          <label className="inline-flex min-h-11 items-center rounded-lg border border-input px-4 text-base font-semibold">
            Choose season file
            <input
              type="file"
              accept="application/json,.json"
              className="sr-only"
              aria-label="Choose season file"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void chooseSeason(file);
                event.target.value = "";
              }}
            />
          </label>
        </div>
        {review ? (
          <div className="flex flex-col gap-3 rounded-[14px] border border-border p-4">
            <p className="text-[14px]">{review.message}</p>
            {review.looksMissing ? <p className="text-[14px] text-destructive">Looks are missing in this file. The current library will stay.</p> : null}
            {review.hostCollision ? (
              <p className="text-[14px] text-destructive">Two Lights would share a host after MAC rematch. Restore will not run until that is fixed.</p>
            ) : null}
            {error ? <p className="text-[14px] text-destructive">{error}</p> : null}
            <SeasonDiffList diff={review.diff} />
            <label className="flex items-center gap-2 text-[14px]">
              <input type="checkbox" checked={pushOnRestore} onChange={(event) => setPushOnRestore(event.target.checked)} />
              <span>Re-push Looks to controllers matched by MAC</span>
            </label>
            <div className="flex flex-wrap gap-3">
              <Button disabled={disabled || Boolean(review.hostCollision)} onClick={() => void restoreSeason()}>Restore season</Button>
              <Button variant="outline" disabled={disabled} onClick={() => setReview(null)}>Cancel</Button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function YardRow({
  row,
  disabled,
  onBlink,
  onFix,
}: {
  row: YardCheckRow;
  disabled: boolean;
  onBlink: () => void;
  onFix: () => void;
}) {
  const unreachable = row.reachability !== "online";
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[18px] font-medium">{row.name}</span>
        <span className={cn("inline-flex items-center gap-1.5 text-[13px]", unreachable ? "text-muted-foreground" : "text-foreground")}>
          <span className="size-1.5 rounded-full" style={{ background: unreachable ? "#8b8680" : row.lit.status === "lit" ? "#6fbf73" : "#8b8680" }} />
          {unreachable ? lastSeenLabel(row.lastSeenAt) : row.lit.detail}
        </span>
        <span className="text-[13px] text-quiet">{row.hostname}{row.port !== 80 ? `:${row.port}` : ""}</span>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button type="button" variant="outline" className="h-8" disabled={disabled || !row.canBlink} onClick={onBlink}>Blink</Button>
          <Button type="button" className="h-8" disabled={disabled || !row.canFix} onClick={onFix}>Fix</Button>
        </div>
      </div>
      {row.props.length > 0 ? (
        <p className="text-[13px] text-muted-foreground">
          Props · {row.props.map((prop) => prop.label).join(", ")}
        </p>
      ) : null}
      <dl className="grid gap-1 text-[13px] sm:grid-cols-2">
        <Compare label="Firmware" compare={row.firmware} />
        <Compare label="Outputs" compare={row.outputs} />
        <Compare label="Ledmap" compare={row.ledmap} />
        <Compare label="Looks" compare={row.looks} />
        <Compare label="Schedule" compare={row.schedule} />
        <Compare label="Sync" compare={row.sync} />
      </dl>
    </div>
  );
}

function Compare({ label, compare }: { label: string; compare: { status: YardCompareStatus; detail: string } }) {
  return (
    <div>
      <dt className="text-quiet">{label} · {STATUS_COPY[compare.status]}</dt>
      <dd>{compare.detail}</dd>
    </div>
  );
}

function SeasonDiffList({ diff }: { diff: SeasonDiff }) {
  return (
    <ul className="text-[14px]">
      <li>Lights {diff.lights.incoming} (now {diff.lights.current}){names(diff.lights)}</li>
      <li>Segments {diff.segments.incoming} (now {diff.segments.current}){names(diff.segments)}</li>
      <li>Props {diff.props.incoming} (now {diff.props.current}){names(diff.props)}</li>
      <li>Setup profiles {diff.profiles.incoming} (now {diff.profiles.current}){names(diff.profiles)}</li>
      <li>
        Looks {diff.looks.missingInFile ? "missing in file" : diff.looks.incoming} (now {diff.looks.current})
        {names(diff.looks)}
      </li>
      <li>Playlists {diff.playlists.incoming} (now {diff.playlists.current}){names(diff.playlists)}</li>
      <li>
        Schedule {diff.schedule.missingInFile ? "missing in file" : diff.schedule.incoming ? "in file" : "none"}
        {diff.schedule.changed ? " · changed" : ""}
      </li>
    </ul>
  );
}

function names(diff: { added: string[]; removed: string[]; changed: string[] }): string {
  const parts = [
    ...diff.added.map((name) => `+${name}`),
    ...diff.removed.map((name) => `−${name}`),
    ...diff.changed.map((name) => `~${name}`),
  ];
  return parts.length ? ` · ${parts.join(", ")}` : "";
}
