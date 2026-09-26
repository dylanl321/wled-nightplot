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

export function createWledProbe(fetchFn: typeof fetch = fetch): ProbeFn {
  return (target) => probeWled(target, fetchFn);
}

export async function probeWled(
  target: HostPort,
  fetchFn: typeof fetch = fetch,
  timeoutMs = TIMEOUT_MS,
): Promise<ProbeOutcome> {
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
      return {
        kind: "probe-failed",
        reason: `${target.hostname} didn’t return a snapshot in ${Math.round(timeoutMs / 1000)} s.`,
      };
    }
    const state = await getJson(fetchFn, `${base}/json/state`, timeoutMs);
    const snap = parseWledPayload({
      info: info.body,
      state: state.ok ? state.body : undefined,
    });
    if (snap) return { kind: "found", snapshot: snap };
    return {
      kind: "not-wled",
      reason: "Answered, but /json/info isn’t WLED. Not added.",
    };
  } catch {
    return {
      kind: "probe-failed",
      reason: `${target.hostname} didn’t return a snapshot in ${Math.round(timeoutMs / 1000)} s.`,
    };
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
