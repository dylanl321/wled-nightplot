import type { HostPort } from "@nightplot/shared";

export type ReadCfgFn = (target: HostPort) => Promise<unknown | null>;
export type WriteCfgFn = (target: HostPort, body: Record<string, unknown>) => Promise<boolean>;

const TIMEOUT_MS = 3000;

export function createWledCfgReader(fetchFn: typeof fetch = fetch): ReadCfgFn {
  return (target) => readWledCfg(target, fetchFn);
}

export function createWledCfgWriter(fetchFn: typeof fetch = fetch): WriteCfgFn {
  return (target, body) => writeWledCfg(target, body, fetchFn);
}

export async function readWledCfg(
  target: HostPort,
  fetchFn: typeof fetch = fetch,
  timeoutMs = TIMEOUT_MS,
): Promise<unknown | null> {
  const url = `http://${hostForUrl(target.hostname)}:${target.port}/json/cfg`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, {
      signal: ac.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function writeWledCfg(
  target: HostPort,
  body: Record<string, unknown>,
  fetchFn: typeof fetch = fetch,
  timeoutMs = TIMEOUT_MS,
): Promise<boolean> {
  const url = `http://${hostForUrl(target.hostname)}:${target.port}/json/cfg`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, {
      method: "POST",
      signal: ac.signal,
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function hostForUrl(hostname: string): string {
  return hostname.includes(":") ? `[${hostname}]` : hostname;
}
