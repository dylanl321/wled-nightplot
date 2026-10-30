import { copyFileSync, readFileSync } from "node:fs";

/**
 * A store file exists but cannot be read or holds rows Nightplot does not
 * understand. Reads must not pass it off as empty, and writes must not
 * replace it. The API answers 503 `store-unreadable`.
 */
export class StoreUnreadableError extends Error {
  constructor(readonly store: string, readonly filePath: string, detail: string) {
    super(`${store} at ${filePath} could not be read (${detail}). Nothing was changed. Fix or restore the file, then reload.`);
    this.name = "StoreUnreadableError";
  }
}

export function isEnoent(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

/** Copy the current file to `<path>.last-good` before it is replaced, when it still parses. */
export function keepLastGood(filePath: string): void {
  try {
    JSON.parse(readFileSync(filePath, "utf8"));
    copyFileSync(filePath, `${filePath}.last-good`);
  } catch { /* missing or already broken: nothing good to keep */ }
}
