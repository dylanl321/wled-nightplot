import type { LightsPayload, NightplotBackupMeta } from "@nightplot/shared";
import { describe, expect, it } from "vitest";
import { backupsPageModel } from "@/lib/backups-page-load";
import { lightView } from "@/test/fixtures";

function lightsPayload(lights = [lightView()]): LightsPayload {
  return { lights, elements: [], unenrolled: [] };
}

function fulfilled<T>(value: T): PromiseFulfilledResult<T> {
  return { status: "fulfilled", value };
}

function rejected(message: string): PromiseRejectedResult {
  return { status: "rejected", reason: new Error(message) };
}

const backups = {
  backups: [] as NightplotBackupMeta[],
  skippedInvalid: 0,
};

describe("backupsPageModel", () => {
  it("uses ServerDown when Lights fail even if backups answered", () => {
    const model = backupsPageModel(rejected("Lights list failed"), fulfilled(backups));
    expect(model).toEqual({ kind: "server-down", error: "Lights list failed" });
  });

  it("keeps enrolled Lights when backups alone fail", () => {
    const lights = lightsPayload();
    const model = backupsPageModel(fulfilled(lights), rejected("Backups failed"));
    expect(model).toEqual({
      kind: "backups-miss",
      lights,
      error: "Backups failed",
    });
  });

  it("returns backups when both loads succeed", () => {
    const lights = lightsPayload();
    const model = backupsPageModel(fulfilled(lights), fulfilled(backups));
    expect(model.kind).toBe("ready");
    if (model.kind !== "ready") return;
    expect(model.lights).toBe(lights);
    expect(model.backups).toEqual([]);
  });
});
