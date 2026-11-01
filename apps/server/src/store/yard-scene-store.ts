import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { isYardHouse, type YardHouse, type YardScene } from "@nightplot/shared";
import { isEnoent, StoreUnreadableError } from "./store-error.ts";

const EMPTY: YardScene = { version: 1, house: null };

/** The house, if the yard has one. A missing file is no house, and is not written. */
export class FileYardSceneStore {
  constructor(private readonly filePath: string) {}

  read(): YardScene {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.filePath, "utf8"));
    } catch (error) {
      if (isEnoent(error)) return EMPTY;
      throw new StoreUnreadableError("Yard scene", this.filePath, error instanceof SyntaxError ? "not JSON" : "unreadable");
    }
    if (!parsed || typeof parsed !== "object" || (parsed as { version?: unknown }).version !== 1) {
      throw new StoreUnreadableError("Yard scene", this.filePath, "unexpected shape or version");
    }
    const house = (parsed as { house?: unknown }).house;
    if (house == null) return EMPTY;
    if (!isYardHouse(house)) throw new StoreUnreadableError("Yard scene", this.filePath, "the house is not one Nightplot understands");
    return { version: 1, house };
  }

  save(house: YardHouse | null): YardScene {
    const next: YardScene = { version: 1, house };
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    renameSync(tmp, this.filePath);
    return this.read();
  }
}
