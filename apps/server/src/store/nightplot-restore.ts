import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { BackupData } from "@nightplot/shared";

export type NightplotRestorePaths = {
  lights: string;
  products: string;
  activity: string;
};

export type RestoreIntent = {
  ready: true;
  files: { dest: string; staged: string }[];
};

export function restoreIntentPath(storePath: string): string {
  return join(dirname(storePath), ".nightplot-restore-intent.json");
}

/** Stage all three Nightplot files, then rename. A crash after the intent is ready finishes on boot. */
export function writeNightplotStoresConsistent(paths: NightplotRestorePaths, data: BackupData): void {
  const files = [
    {
      dest: paths.lights,
      body: `${JSON.stringify({ version: 1, lights: data.lights, elements: data.elements }, null, 2)}\n`,
    },
    {
      dest: paths.products,
      body: `${JSON.stringify({ version: 1, products: data.products }, null, 2)}\n`,
    },
    {
      dest: paths.activity,
      body: `${JSON.stringify({ version: 1, entries: data.activity }, null, 2)}\n`,
    },
  ];
  const staged = files.map((file) => ({ dest: file.dest, staged: `${file.dest}.restore-new`, body: file.body }));
  const intent = restoreIntentPath(paths.lights);
  try {
    for (const row of staged) {
      mkdirSync(dirname(row.dest), { recursive: true });
      writeFileSync(row.staged, row.body, "utf8");
    }
    writeFileSync(intent, `${JSON.stringify({
      ready: true,
      files: staged.map(({ dest, staged: stagedPath }) => ({ dest, staged: stagedPath })),
    } satisfies RestoreIntent)}\n`);
  } catch (error) {
    for (const row of staged) {
      try { unlinkSync(row.staged); } catch { /* keep the first failure */ }
    }
    try { unlinkSync(intent); } catch { /* keep the first failure */ }
    throw error;
  }
  finishRestoreIntent(intent);
}

export function recoverInterruptedRestore(storePath: string): void {
  finishRestoreIntent(restoreIntentPath(storePath));
}

export function finishRestoreIntent(intentPath: string): void {
  let parsed: RestoreIntent;
  try {
    parsed = JSON.parse(readFileSync(intentPath, "utf8")) as RestoreIntent;
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
  if (parsed.ready !== true || !Array.isArray(parsed.files)) {
    try { unlinkSync(intentPath); } catch { /* incomplete intent is discarded */ }
    return;
  }
  for (const file of parsed.files) {
    if (typeof file.dest !== "string" || typeof file.staged !== "string") continue;
    try {
      renameSync(file.staged, file.dest);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
  try { unlinkSync(intentPath); } catch { /* finished */ }
}

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
