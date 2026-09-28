"use client";

import type { LightDetail } from "@nightplot/shared";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { fetchJson } from "@/lib/api";

type RecoveryResponse = LightDetail & {
  recovery: { cleared: boolean; wrote: boolean; restored: false; message: string };
};

export function PreviewRecovery({ lightId, lightName, disabled, onBusy, onRecovered }: {
  lightId: string;
  lightName: string;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
  onRecovered: (detail: LightDetail, message: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function recover() {
    setRunning(true);
    setError(null);
    onBusy(true);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const result = await fetchJson<RecoveryResponse>(`/api/lights/${lightId}/preview/recover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ discardFrozenPixels: true }),
        signal: controller.signal,
      });
      if (!result.light || !Array.isArray(result.elements) || !result.recovery?.cleared) {
        throw new Error("Recovery was not confirmed. Refresh to check the controller before retrying.");
      }
      onRecovered(result, result.recovery.message);
    } catch (caught) {
      setError(controller.signal.aborted
        ? "Recovery did not respond in time. Its write is not confirmed. Refresh before retrying."
        : caught instanceof Error ? caught.message : "Recovery was not confirmed. Refresh before retrying.");
      setConfirming(false);
    } finally {
      clearTimeout(timeout);
      setRunning(false);
      onBusy(false);
    }
  }

  return <section aria-label="Preview recovery" className="rounded-xl border border-primary/60 bg-[#15130f] px-4 py-3.5">
    <p className="text-[15px] font-medium text-primary">Frozen LEDs are blocking Preview</p>
    <p className="mt-1 text-[13px] text-[#c9c3b8]">
      {lightName} is holding frozen per-LED colours. Nightplot has no original snapshot to restore.
    </p>
    {confirming ? <div className="mt-3 flex flex-col gap-3 border-t border-border pt-3">
      <p className="text-[13px] text-[#c9c3b8]">
        Clearing these LEDs discards their current per-LED colours and resumes the controller’s normal output.
        The previous look cannot be restored. Saved Segments stay unchanged, and Preview stays off.
      </p>
      <p className="text-[12px] text-muted-foreground">
        Nightplot checks this controller again before writing and reads it back afterward.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button className="h-9 text-[13px]" disabled={disabled || running} onClick={() => void recover()}>
          {running ? "Clearing frozen LEDs…" : "Clear frozen LEDs"}
        </Button>
        <Button variant="outline" className="h-9 text-[13px]" disabled={running} onClick={() => setConfirming(false)}>Cancel</Button>
      </div>
    </div> : <Button variant="outline" className="mt-3 h-9 text-[13px]" disabled={disabled || running} onClick={() => { setError(null); setConfirming(true); }}>
      Recover Preview…
    </Button>}
    {error ? <p role="alert" className="mt-3 text-[13px] text-destructive">{error}</p> : null}
  </section>;
}
