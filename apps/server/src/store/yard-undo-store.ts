import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { isYardUndoToken, type YardUndoToken } from "@nightplot/shared";
import { isEnoent } from "./store-error.ts";

export class FileYardUndoStore {
  constructor(private readonly filePath: string) {}

  read(): YardUndoToken | null {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.filePath, "utf8"));
      return isYardUndoToken(parsed) ? parsed : null;
    } catch (error) {
      if (isEnoent(error)) return null;
      return null;
    }
  }

  save(token: YardUndoToken): YardUndoToken {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(token, null, 2)}\n`, "utf8");
    renameSync(tmp, this.filePath);
    return token;
  }

  clear(): void {
    try { unlinkSync(this.filePath); } catch { /* already gone */ }
  }
}
