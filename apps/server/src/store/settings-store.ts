import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { defaultNightplotSettings, isNightplotSettings, type NightplotSettings } from "@nightplot/shared";

export class FileSettingsStore {
  constructor(private readonly filePath: string) {}

  get path(): string {
    return this.filePath;
  }

  read(): NightplotSettings {
    try {
      const value: unknown = JSON.parse(readFileSync(this.filePath, "utf8"));
      if (!isNightplotSettings(value)) throw new Error("Invalid Nightplot settings; nothing was overwritten.");
      return value;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT")
        return defaultNightplotSettings();
      throw error;
    }
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
