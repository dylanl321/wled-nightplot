"use client";

import type { ActivityEntry } from "@nightplot/shared";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { fetchJson } from "@/lib/api";

export function ActivityPanel({ lightId }: { lightId: string }) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  async function load() {
    setBusy(true);
    try {
      const result = await fetchJson<{ entries: ActivityEntry[] }>(
        `/api/activity?lightId=${encodeURIComponent(lightId)}`,
      );
      setEntries(result.entries);
      setError(null);
    } catch {
      setError("Activity could not be loaded. Try again.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void load(); }, [lightId]);

  return (
    <section className="flex flex-col gap-4 rounded-[14px] border border-border bg-card p-5" aria-label="Activity">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium">Activity</h2>
          <p className="text-[13px] text-muted-foreground">Saved actions and controller readback. A match is software readback, not proof the strip lit.</p>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={busy}>Refresh activity</Button>
      </div>
      {error ? <p role="alert" className="text-destructive">{error}</p> : null}
      {busy && entries.length === 0 ? <p className="text-muted-foreground">Loading activity…</p> : null}
      {!busy && !error && entries.length === 0 ? <p className="text-muted-foreground">No activity recorded for this Light yet.</p> : null}
      <ol className="divide-y divide-border">
        {entries.map((entry) => (
          <li key={entry.id} className="flex flex-col gap-1 py-3 text-[13px]">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{entry.action === "all-off" ? "All Off" : entry.action === "apply" ? "Apply" : entry.action === "replacement" ? "Controller replaced" : "Preview"}</span>
              <span className="text-muted-foreground">{new Date(entry.at).toLocaleString()}</span>
              <span className="ml-auto text-muted-foreground">{entry.readback === "match" ? "Readback matched" : entry.readback === "mismatch" ? "Readback differs" : entry.readback === "unknown" ? "Readback unknown" : "Not checked"}</span>
            </div>
            <p className="text-muted-foreground">{entry.detail}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
