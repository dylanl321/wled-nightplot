import type { HostPort } from "@nightplot/shared";

export type WledNativeFiles = { cfgJson: string; presetsJson: string };
export type ReadWledNativeFiles = (target: HostPort) => Promise<WledNativeFiles>;
export type WriteWledNativeFiles = (target: HostPort, files: WledNativeFiles) => Promise<void>;
export type ReadWledConfigExport = (target: HostPort) => Promise<string>;

function advertisedHost(target: HostPort): string {
  return target.hostname.includes(":") ? `[${target.hostname}]` : target.hostname;
}

/** Fresh `/cfg.json` only — Settings inspect. Not a full WLED backup. */
export function createWledConfigExportReader(fetchFn: typeof fetch = fetch): ReadWledConfigExport {
  return async (target) => {
    const host = advertisedHost(target);
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
    const host = advertisedHost(target);
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

/**
 * WLED Security & Updates restore is POST /upload of the same two filenames.
 * Configuration upload typically reboots the box. Presets are sent first.
 */
export function createWledNativeFilesWriter(fetchFn: typeof fetch = fetch): WriteWledNativeFiles {
  return async (target, files) => {
    const host = advertisedHost(target);
    await uploadNativeFile(fetchFn, host, target.port, "presets.json", files.presetsJson);
    await uploadNativeFile(fetchFn, host, target.port, "cfg.json", files.cfgJson);
  };
}

export async function uploadNativeFile(
  fetchFn: typeof fetch,
  host: string,
  port: number,
  filename: string,
  body: string,
): Promise<void> {
  const form = new FormData();
  form.append("data", new Blob([body], { type: "application/json" }), filename);
  let response: Response;
  try {
    response = await fetchFn(`http://${host}:${port}/upload`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(8000),
    });
  } catch (error) {
    if (filename === "cfg.json") return;
    throw error instanceof Error ? error : new Error(`WLED ${filename} upload failed.`);
  }
  if (!response.ok) {
    throw new Error(`WLED ${filename} upload returned HTTP ${response.status}.`);
  }
}

export type ReadWledPresets = (target: HostPort) => Promise<string>;
export type WriteWledPresets = (target: HostPort, presetsJson: string) => Promise<void>;

/** Fresh `/presets.json` only — Sync source and reread. */
export function createWledPresetsReader(fetchFn: typeof fetch = fetch): ReadWledPresets {
  return async (target) => {
    const response = await fetchFn(`http://${advertisedHost(target)}:${target.port}/presets.json`, {
      signal: AbortSignal.timeout(5000), headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`WLED presets.json returned HTTP ${response.status}.`);
    const raw = await response.text();
    if (raw.length > 8_000_000) throw new Error("WLED presets.json exceeds the size limit.");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("WLED presets.json was not a JSON object.");
    return raw;
  };
}

/** Upload `presets.json` alone. WLED takes it without a reboot (`presetsModifiedTime`). */
export function createWledPresetsWriter(fetchFn: typeof fetch = fetch): WriteWledPresets {
  return (target, presetsJson) => uploadNativeFile(fetchFn, advertisedHost(target), target.port, "presets.json", presetsJson);
}

export type ReadWledLedmap = (target: HostPort) => Promise<string | null>;
export type WriteWledLedmap = (target: HostPort, ledmapJson: string) => Promise<void>;

/** Fresh `/ledmap.json`. Missing file is null — not an empty match. */
export function createWledLedmapReader(fetchFn: typeof fetch = fetch): ReadWledLedmap {
  return async (target) => {
    const response = await fetchFn(`http://${advertisedHost(target)}:${target.port}/ledmap.json`, {
      signal: AbortSignal.timeout(5000), headers: { Accept: "application/json" },
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`WLED ledmap.json returned HTTP ${response.status}.`);
    const raw = await response.text();
    if (raw.length > 2_000_000) throw new Error("WLED ledmap.json exceeds the size limit.");
    return raw;
  };
}

/** Upload `ledmap.json` through the same WLED /upload path as presets. */
export function createWledLedmapWriter(fetchFn: typeof fetch = fetch): WriteWledLedmap {
  return (target, ledmapJson) => uploadNativeFile(fetchFn, advertisedHost(target), target.port, "ledmap.json", ledmapJson);
}
