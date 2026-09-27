import {
  parseWledPayload,
  type HostPort,
  type WledSnapshot,
} from "@nightplot/shared";

export type ProbeOutcome =
  | { kind: "found"; snapshot: WledSnapshot }
  | { kind: "probe-failed"; reason: string }
  | { kind: "not-wled"; reason: string };

export type ProbeFn = (target: HostPort) => Promise<ProbeOutcome>;

const TIMEOUT_MS = 3000;

/**
 * After /json/info already proved liveness, /json/state is enrichment only.
 * A hang must not add another full CONFIG-15 abort budget.
 */
export const PROBE_STATE_AFTER_INFO_MS = 400;

/** Below this, a duration in the reason would be misleading (instant refuse). */
export const PROBE_FAILED_ELAPSED_MIN_MS = 500;

export function probeFailedReason(hostname: string, elapsedMs: number): string {
  const waited = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  if (waited < PROBE_FAILED_ELAPSED_MIN_MS) {
    return "probe failed.";
  }
  const seconds = Math.max(1, Math.round(waited / 1000));
  return `${hostname} didn’t return a snapshot in ${seconds} s.`;
}

export function createWledProbe(fetchFn: typeof fetch = fetch): ProbeFn {
  return (target) => probeWled(target, fetchFn);
}

export async function probeWled(
  target: HostPort,
  fetchFn: typeof fetch = fetch,
  timeoutMs = TIMEOUT_MS,
): Promise<ProbeOutcome> {
  const started = Date.now();
  const failed = (): ProbeOutcome => ({
    kind: "probe-failed",
    reason: probeFailedReason(target.hostname, Date.now() - started),
  });
  const base = `http://${hostForUrl(target.hostname)}:${target.port}`;
  try {
    const combined = await getJson(fetchFn, `${base}/json`, timeoutMs);
    if (combined.ok) {
      const snap = parseWledPayload(combined.body);
      if (snap) return { kind: "found", snapshot: snap };
      return {
        kind: "not-wled",
        reason: "Answered, but /json isn’t WLED. Not added.",
      };
    }

    const info = await getJson(fetchFn, `${base}/json/info`, timeoutMs);
    if (!info.ok) {
      return failed();
    }
    const infoOnly = parseWledPayload({ info: info.body });
    if (!infoOnly) {
      return {
        kind: "not-wled",
        reason: "Answered, but /json/info isn’t WLED. Not added.",
      };
    }

    const remaining = timeoutMs - (Date.now() - started);
    const stateTimeout = Math.min(PROBE_STATE_AFTER_INFO_MS, remaining);
    if (stateTimeout <= 0) {
      return { kind: "found", snapshot: infoOnly };
    }
    const state = await getJson(fetchFn, `${base}/json/state`, stateTimeout);
    if (!state.ok) {
      return { kind: "found", snapshot: infoOnly };
    }
    const enriched = parseWledPayload({
      info: info.body,
      state: state.body,
    });
    return { kind: "found", snapshot: enriched ?? infoOnly };
  } catch {
    return failed();
  }
}

async function getJson(
  fetchFn: typeof fetch,
  url: string,
  timeoutMs: number,
): Promise<{ ok: true; body: unknown } | { ok: false }> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, {
      signal: ac.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return { ok: false };
    const body: unknown = await res.json();
    return { ok: true, body };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

function hostForUrl(hostname: string): string {
  return hostname.includes(":") ? `[${hostname}]` : hostname;
}
