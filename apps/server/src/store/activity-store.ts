import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseActivityEntry, type ActivityEntry } from "@nightplot/shared";

type ActivityFile = { version: 1; entries: ActivityEntry[] };

export type ActivityExport =
  | { ok: true; entries: ActivityEntry[] }
  | { ok: false; error: "invalid" | "unreadable" };

/** Append-only (up to the latest 1000 entries) local JSON history, independent of Lights. */
export class FileActivityStore {
  constructor(private readonly filePath: string) {}

  get path(): string {
    return this.filePath;
  }

  list(lightId?: string): ActivityEntry[] {
    const entries = this.read();
    return (lightId ? entries.filter((entry) => entry.lightId === lightId) : entries).reverse();
  }

  tryExport(): ActivityExport {
    try {
      return { ok: true, entries: this.read() };
    } catch (error) {
      if (isEnoent(error)) return { ok: true, entries: [] };
      return { ok: false, error: messageLooksUnreadable(error) ? "unreadable" : "invalid" };
    }
  }

  append(entry: ActivityEntry): void {
    const entries = [...this.read(), entry].slice(-1000);
    this.write(entries);
  }

  replaceAll(entries: ActivityEntry[]): void {
    this.write(entries);
  }

  private write(entries: ActivityEntry[]): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, `${JSON.stringify({ version: 1, entries } satisfies ActivityFile, null, 2)}\n`);
    renameSync(tmp, this.filePath);
  }

  private read(): ActivityEntry[] {
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as ActivityFile;
      if (parsed.version !== 1 || !Array.isArray(parsed.entries) ||
        !parsed.entries.every((entry) => parseActivityEntry(entry))) {
        throw new Error("Invalid Activity history");
      }
      return parsed.entries.map((entry) => parseActivityEntry(entry)!);
    } catch (error) {
      if (isEnoent(error)) return [];
      throw error;
    }
  }
}

function isEnoent(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function messageLooksUnreadable(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error);
}
