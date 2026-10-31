import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { isSetupProfile, type SetupProfile } from "@nightplot/shared";
import { isEnoent, StoreUnreadableError } from "./store-error.ts";

type FileShape = {
  version: 1;
  profiles: SetupProfile[];
};

export class FileSetupProfilesStore {
  constructor(private readonly filePath: string) {}

  get path(): string {
    return this.filePath;
  }

  list(): SetupProfile[] {
    return this.read();
  }

  findById(id: string): SetupProfile | undefined {
    return this.read().find((profile) => profile.id === id);
  }

  upsert(profile: SetupProfile): SetupProfile {
    const profiles = this.read();
    const next = [...profiles.filter((row) => row.id !== profile.id), profile];
    this.write(next);
    return profile;
  }

  remove(id: string): boolean {
    const profiles = this.read();
    if (!profiles.some((profile) => profile.id === id)) return false;
    this.write(profiles.filter((profile) => profile.id !== id));
    return true;
  }

  replaceAll(profiles: SetupProfile[]): SetupProfile[] {
    if (!profiles.every(isSetupProfile)) {
      throw new StoreUnreadableError(
        "Setup profiles store",
        this.filePath,
        "a profile row Nightplot does not understand",
      );
    }
    this.write(profiles);
    return profiles;
  }

  private read(): SetupProfile[] {
    let parsed: FileShape;
    try {
      parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as FileShape;
    } catch (error) {
      if (isEnoent(error)) return [];
      throw new StoreUnreadableError(
        "Setup profiles store",
        this.filePath,
        error instanceof SyntaxError ? "not JSON" : "unreadable",
      );
    }
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.profiles)) {
      throw new StoreUnreadableError(
        "Setup profiles store",
        this.filePath,
        "unexpected shape or version",
      );
    }
    if (!parsed.profiles.every(isSetupProfile)) {
      throw new StoreUnreadableError(
        "Setup profiles store",
        this.filePath,
        "a profile row Nightplot does not understand",
      );
    }
    return parsed.profiles;
  }

  private write(profiles: SetupProfile[]): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    const body: FileShape = { version: 1, profiles };
    writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`, "utf8");
    renameSync(tmp, this.filePath);
  }
}
