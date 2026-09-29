import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ActivityEntry } from "@nightplot/shared";

type ActivityFile = { version: 1; entries: ActivityEntry[] };

/** Append-only (up to the latest 1000 entries) local JSON history, independent of Lights. */
export class FileActivityStore {
  constructor(private readonly filePath: string) {}

  list(lightId?: string): ActivityEntry[] {
    const entries = this.read();
    return (lightId ? entries.filter((entry) => entry.lightId === lightId) : entries).reverse();
  }

  append(entry: ActivityEntry): void {
    const entries = [...this.read(), entry].slice(-1000);
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, `${JSON.stringify({ version: 1, entries } satisfies ActivityFile, null, 2)}\n`);
    renameSync(tmp, this.filePath);
  }

  private read(): ActivityEntry[] {
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as ActivityFile;
      if (parsed.version !== 1 || !Array.isArray(parsed.entries) ||
        !parsed.entries.every(isActivityEntry)) throw new Error("Invalid Activity history");
      return parsed.entries;
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return [];
      throw error;
    }
  }
}

function isActivityEntry(value: unknown): value is ActivityEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<ActivityEntry>;
  return typeof entry.id === "string" && typeof entry.at === "string" &&
    typeof entry.lightId === "string" && typeof entry.lightName === "string" &&
    (entry.action === "apply" || entry.action === "preview" || entry.action === "all-off") &&
    (entry.readback === "match" || entry.readback === "mismatch" ||
      entry.readback === "unknown" || entry.readback === "not-checked") &&
    typeof entry.detail === "string";
}
