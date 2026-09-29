import { describe, expect, it } from "vitest";
import type { Light } from "./lights.ts";
import {
  BACKUP_KEEP_AUTOMATIC_DEFAULT,
  CONTROLLER_CFG_MISSING,
  CONTROLLER_STATE_MISSING,
  NIGHTPLOT_DATA_BACKUP_KIND,
  backupPersistRefuseMessage,
  backupReasonLabel,
  backupRetentionClass,
  buildNightplotDataBackup,
  controllerCaptureFrom,
  diffNightplotData,
  parseNightplotDataBackup,
} from "./nightplot-backup.ts";

const light: Light = {
  id: "porch",
  name: "Porch",
  controllerKind: "wled",
  stripKind: "ws281x",
  hostname: "192.168.1.40",
  port: 80,
  hostKey: "192.168.1.40:80",
  mac: "aa:bb:cc:dd:ee:ff",
  firmware: "WLED 0.15.4",
  ledCount: 60,
  rgbw: false,
  reachability: "online",
  lastSeenAt: "2026-09-29T00:00:00.000Z",
  on: true,
  brightness: 128,
  enrolledAt: "2026-09-28T00:00:00.000Z",
  ledProductId: null,
};

const nightplot = {
  lights: [light],
  elements: [{ id: "el-1", lightId: "porch", label: "Eave", start: 0, stop: 20 }],
  ledProducts: [],
  activity: [],
};

describe("Nightplot data backups", () => {
  it("validates kind, version, completeness, and required Nightplot data", () => {
    const backup = buildNightplotDataBackup({
      id: "098d2956-a7a8-4bf5-9d13-a13adbeae60f",
      createdAt: "2026-09-29T00:00:00.000Z",
      reason: "manual",
      nightplot,
    });
    expect(backup.kind).toBe(NIGHTPLOT_DATA_BACKUP_KIND);
    expect(backup.completeness).toBe("complete");
    expect(parseNightplotDataBackup({ ...backup, version: 2 })).toBeNull();
    expect(parseNightplotDataBackup({ ...backup, kind: "nightplot-segments" })).toBeNull();
    expect(parseNightplotDataBackup({ ...backup, completeness: "complete", incomplete: ["x"] })).toBeNull();
    expect(parseNightplotDataBackup({
      ...backup,
      nightplot: { ...nightplot, lights: [{ ...light, port: 0 }] },
    })).toBeNull();
  });

  it("marks a missing controller state or cfg as a partial reference capture", () => {
    const controller = controllerCaptureFrom({
      light,
      state: null,
      cfg: null,
      capturedAt: "2026-09-29T00:00:00.000Z",
    });
    const backup = buildNightplotDataBackup({
      id: "11111111-1111-4111-8111-111111111111",
      createdAt: "2026-09-29T00:00:00.000Z",
      reason: "pre-apply",
      nightplot,
      controller,
    });
    expect(backup.completeness).toBe("partial");
    expect(backup.incomplete).toEqual([CONTROLLER_STATE_MISSING, CONTROLLER_CFG_MISSING]);
    expect(backup.controller?.kind).toBe("wled-reference");
    expect(backupRetentionClass("pre-apply")).toBe("automatic");
    expect(backupRetentionClass("pre-restore")).toBe("safety");
    expect(backupRetentionClass("manual")).toBe("manual");
    expect(backupReasonLabel("pre-apply")).toBe("Before Apply");
    expect(BACKUP_KEEP_AUTOMATIC_DEFAULT).toBe(40);
    expect(backupPersistRefuseMessage("Apply")).toMatch(/Apply was not sent/);
  });

  it("reviews a restore as Nightplot-only add/remove/change", () => {
    const current = {
      lights: [{ ...light, name: "Porch west" }, { ...light, id: "roof", name: "Roof", hostKey: "192.168.1.41:80", hostname: "192.168.1.41" }],
      elements: [{ id: "el-1", lightId: "porch", label: "Eave", start: 0, stop: 24 }],
      ledProducts: [],
      activity: [{
        id: "act-1",
        at: "2026-09-29T00:01:00.000Z",
        lightId: "porch",
        lightName: "Porch",
        action: "apply" as const,
        readback: "match" as const,
        detail: "Applied",
      }],
    };
    const diff = diffNightplotData(current, nightplot);
    expect(diff.lights.wouldChange.map((row) => row.id)).toEqual(["porch"]);
    expect(diff.lights.wouldRemove.map((row) => row.id)).toEqual(["roof"]);
    expect(diff.elements.wouldChange).toBe(1);
    expect(diff.activity.current).toBe(1);
    expect(diff.summary).toMatch(/Restores Lights, Segments, LED products, and Activity/);
    expect(diff.summary).not.toMatch(/Apply to/);
  });
});
