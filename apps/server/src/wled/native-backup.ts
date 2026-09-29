import type { HostPort } from "@nightplot/shared";

export type WledNativeFiles = { cfgJson: string; presetsJson: string };
export type ReadWledNativeFiles = (target: HostPort) => Promise<WledNativeFiles>;
export type ReadWledConfigExport = (target: HostPort) => Promise<string>;

export function createWledConfigExportReader(fetchFn: typeof fetch = fetch): ReadWledConfigExport {
  return async (target) => {
    const host = target.hostname.includes(":") ? `[${target.hostname}]` : target.hostname;
    const response = await fetchFn(`http://${host}:${target.port}/cfg.json`, {
      signal: AbortSignal.timeout(5000), headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`WLED cfg.json returned HTTP ${response.status}.`);
    const raw = await response.text();
    if (raw.length > 2_000_000) throw new Error("WLED cfg.json exceeds the size limit.");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("WLED cfg.json was not an object.");
    return raw;
  };
}

/** WLED Security & Updates downloads these two native files separately. */
export function createWledNativeFilesReader(fetchFn: typeof fetch = fetch): ReadWledNativeFiles {
  return async (target) => {
    const host = target.hostname.includes(":") ? `[${target.hostname}]` : target.hostname;
    async function read(name: "cfg" | "presets", limit: number): Promise<string> {
      const response = await fetchFn(`http://${host}:${target.port}/${name}.json`, {
        signal: AbortSignal.timeout(5000), headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error(`WLED ${name}.json returned HTTP ${response.status}.`);
      const raw = await response.text();
      if (raw.length > limit) throw new Error(`WLED ${name}.json exceeds the backup size limit.`);
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error(`WLED ${name}.json was not a JSON object.`);
      return raw;
    }
    return { cfgJson: await read("cfg", 2_000_000), presetsJson: await read("presets", 8_000_000) };
  };
}
