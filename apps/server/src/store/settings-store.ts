import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { defaultNightplotSettings, isNightplotSettings, type NightplotSettings } from "@nightplot/shared";
import { isEnoent, StoreUnreadableError } from "./store-error.ts";

export class FileSettingsStore {
  constructor(private readonly filePath: string) {}

  get path(): string {
    return this.filePath;
  }

  read(): NightplotSettings {
    let value: unknown;
    try {
      value = JSON.parse(readFileSync(this.filePath, "utf8"));
    } catch (error) {
      if (isEnoent(error)) return defaultNightplotSettings();
      throw new StoreUnreadableError("Settings store", this.filePath, error instanceof SyntaxError ? "not JSON" : "unreadable");
    }
    if (!isNightplotSettings(value)) throw new StoreUnreadableError("Settings store", this.filePath, "unexpected shape or version");
    return value;
  }

  save(input: unknown): { settings?: NightplotSettings; error?: "invalid" | "conflict" } {
    if (!isNightplotSettings(input)) return { error: "invalid" };
    const current = this.read();
    if (input.revision !== current.revision) return { error: "conflict" };
    const next = { ...input, revision: current.revision + 1 };
    this.restore(next);
    return { settings: next };
  }

  restore(settings: NightplotSettings): void {
    if (!isNightplotSettings(settings)) throw new Error("Invalid backup preferences; nothing was restored.");
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, this.filePath);
  }
}
