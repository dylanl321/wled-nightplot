"use client";

import type { LightDetail } from "@nightplot/shared";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { postJson } from "@/lib/api";

type ReplacementCheck = {
  previous: { hostKey: string; mac: string | null; name: string };
  replacement: { hostKey: string; mac: string; name: string; ledCount: number };
  segmentCount: number;
  message: string;
};

export function ControllerReplacement({ detail, onUpdated }: {
  detail: LightDetail;
  onUpdated: (next: LightDetail) => void;
}) {
  const [open, setOpen] = useState(false);
  const [host, setHost] = useState(detail.light.displayHost);
  const [checked, setChecked] = useState<ReplacementCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function check() {
    setChecked(null);
    setError(null);
    setBusy(true);
    try {
      const res = await postJson<ReplacementCheck>(`/api/lights/${detail.light.id}/replacement/check`, { host });
      if (res.ok) setChecked(res.data);
      else setError(res.data.message ?? "The replacement could not be checked.");
    } catch {
      setError("Could not reach Nightplot to check the replacement.");
    } finally {
      setBusy(false);
    }
  }

  async function replace() {
    if (!checked) return;
    setBusy(true);
    setError(null);
    try {
      const res = await postJson<LightDetail & { message: string }>(
        `/api/lights/${detail.light.id}/replacement`,
        { host, confirm: true, expectedHostKey: checked.replacement.hostKey,
          expectedMac: checked.replacement.mac, previousHostKey: checked.previous.hostKey,
          previousMac: checked.previous.mac },
      );
      if (!res.ok) {
        setChecked(null);
        setError(res.data.message ?? "The controller was not replaced. Check again.");
        return;
      }
      onUpdated(res.data);
      setHost(res.data.light.displayHost);
      setChecked(null);
      setNotice(res.data.message);
    } catch {
      setChecked(null);
      setError("Could not confirm the replacement. Refresh this Light before trying again.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="mt-4 border-t border-border pt-4 text-[13px]">
    <button type="button" onClick={() => { setOpen(!open); setChecked(null); setError(null); }}
      className="text-primary">{open ? "Close replacement" : "Replace controller…"}</button>
    {open ? <div className="mt-3 flex flex-col gap-3">
      <p className="text-muted-foreground">For a new WLED controller on the same physical strip. This keeps this Light’s saved Segments, but changes its controller identity and address. It does not copy controller settings, Preview, or Apply ranges.</p>
      <div className="flex flex-wrap items-center gap-2">
        <Input aria-label="Replacement host or host:port" value={host}
          onChange={(event) => { setHost(event.target.value); setChecked(null); setNotice(null); }}
          className="max-w-64 font-mono" />
        <Button variant="outline" disabled={busy || !host.trim()} onClick={() => void check()}>
          {busy ? "Checking…" : "Check replacement"}
        </Button>
      </div>
      {error ? <p role="alert" className="text-destructive">{error}</p> : null}
      {notice ? <p role="status" className="text-online">{notice}</p> : null}
      {checked ? <div className="space-y-2 rounded-lg border border-border p-3">
        <p>Current: {checked.previous.name} · {checked.previous.hostKey} · MAC {checked.previous.mac ?? "unknown"}</p>
        <p>Replacement: {checked.replacement.name} · {checked.replacement.hostKey} · MAC {checked.replacement.mac} · {checked.replacement.ledCount} LEDs</p>
        <p>{checked.segmentCount} saved Segment{checked.segmentCount === 1 ? " stays" : "s stay"} on this Light. Check Strip hardware, then use Apply separately when ready.</p>
        <Button disabled={busy} onClick={() => void replace()}>
          {busy ? "Replacing…" : `Confirm replacement for ${detail.light.name}`}
        </Button>
      </div> : null}
    </div> : null}
  </div>;
}
