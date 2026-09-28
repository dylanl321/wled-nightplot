import type { DiscoverRow } from "@nightplot/shared";
import { postJson } from "@/lib/api";

/** Slow background Find while a Nightplot page is open. */
export const DISCOVERY_SCAN_INTERVAL_MS = 60_000;

export type DiscoveryScanResult =
  | { ok: true; candidates: DiscoverRow[] }
  | { ok: false; message: string };

export function shouldStartDiscoveryScan(input: {
  visibility: "visible" | "hidden" | string;
  inFlight: boolean;
}): boolean {
  return input.visibility !== "hidden" && !input.inFlight;
}

type Listener = (candidates: DiscoverRow[]) => void;

const listeners = new Set<Listener>();
let inFlight: Promise<DiscoveryScanResult> | null = null;

export function subscribeDiscoveryScan(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function discoveryScanInFlight(): boolean {
  return inFlight !== null;
}

/** One LAN Find. A second caller waits on the scan already running. */
export function runDiscoveryScan(): Promise<DiscoveryScanResult> {
  if (inFlight) return inFlight;
  let scan: Promise<DiscoveryScanResult>;
  scan = postDiscover().finally(() => {
    if (inFlight === scan) inFlight = null;
  });
  inFlight = scan;
  return scan;
}

async function postDiscover(): Promise<DiscoveryScanResult> {
  try {
    const res = await postJson<{ candidates: DiscoverRow[] }>("/api/discover");
    if (!res.ok) {
      return { ok: false, message: res.data.message ?? "Find Lights failed." };
    }
    const candidates = res.data.candidates ?? [];
    for (const listener of listeners) listener(candidates);
    return { ok: true, candidates };
  } catch (caught) {
    return {
      ok: false,
      message: caught instanceof Error ? caught.message : "Find Lights failed.",
    };
  }
}
