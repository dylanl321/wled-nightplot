import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  defaultLooksDocument,
  isLook,
  isLookPlaylist,
  isLooksDocument,
  isNightlySchedule,
  normalizeLook,
  normalizePlaylist,
  type Look,
  type LookPlaylist,
  type LooksDocument,
  type NightlySchedule,
} from "@nightplot/shared";
import { isEnoent, StoreUnreadableError } from "./store-error.ts";

export class FileLooksStore {
  constructor(private readonly filePath: string) {}

  get path(): string {
    return this.filePath;
  }

  read(): LooksDocument {
    return this.load();
  }

  save(document: LooksDocument): LooksDocument {
    const next: LooksDocument = {
      version: 1,
      looks: document.looks.map(normalizeLook),
      playlists: document.playlists.map(normalizePlaylist),
      schedule: document.schedule,
      ...(document.sectionColoursMigrated ? { sectionColoursMigrated: true as const } : {}),
    };
    this.write(next);
    return next;
  }

  looks(): Look[] {
    return this.load().looks;
  }

  playlists(): LookPlaylist[] {
    return this.load().playlists;
  }

  schedule(): NightlySchedule | null {
    return this.load().schedule;
  }

  private load(): LooksDocument {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.filePath, "utf8"));
    } catch (error) {
      if (isEnoent(error)) return defaultLooksDocument();
      throw new StoreUnreadableError(
        "Looks store",
        this.filePath,
        error instanceof SyntaxError ? "not JSON" : "unreadable",
      );
    }
    if (!isLooksDocument(parsed)) {
      throw new StoreUnreadableError("Looks store", this.filePath, "unexpected shape or version");
    }
    if (!parsed.looks.every(isLook) || !parsed.playlists.every(isLookPlaylist)) {
      throw new StoreUnreadableError("Looks store", this.filePath, "a Look or playlist row Nightplot does not understand");
    }
    if (parsed.schedule != null && !isNightlySchedule(parsed.schedule)) {
      throw new StoreUnreadableError("Looks store", this.filePath, "a Schedule Nightplot does not understand");
    }
    return {
      version: 1,
      looks: parsed.looks.map(normalizeLook),
      playlists: parsed.playlists.map(normalizePlaylist),
      schedule: parsed.schedule ?? null,
      ...(parsed.sectionColoursMigrated ? { sectionColoursMigrated: true as const } : {}),
    };
  }

  private write(document: LooksDocument): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    renameSync(tmp, this.filePath);
  }
}
