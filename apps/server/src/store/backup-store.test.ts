import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildNightplotDataBackup, type Light } from "@nightplot/shared";
import { FileBackupStore } from "./backup-store.ts";

const light: Light = {
  id: "porch",
  name: "Porch",
  controllerKind: "wled",
  stripKind: "ws281x",
  hostname: "192.168.1.40",
  port: 80,
  hostKey: "192.168.1.40:80",
  mac: null,
  firmware: null,
  ledCount: 60,
  rgbw: false,
  reachability: "no-answer",
  lastSeenAt: null,
  on: null,
  brightness: null,
  enrolledAt: "2026-09-28T00:00:00.000Z",
  ledProductId: null,
};

function backup(id: string, reason: "manual" | "pre-apply" | "pre-restore", createdAt: string) {
  return buildNightplotDataBackup({
    id,
    createdAt,
    reason,
    nightplot: { lights: [light], elements: [], ledProducts: [], activity: [] },
  });
}

describe("FileBackupStore", () => {
  it("writes, lists newest first, downloads only valid files, and requires a real id", () => {
    const dir = mkdtempSync(join(tmpdir(), "nightplot-backups-"));
    const store = new FileBackupStore(dir, 2, 1);
    const first = store.create(backup("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "manual", "2026-09-29T00:00:00.000Z"));
    const second = store.create(backup("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "pre-apply", "2026-09-29T01:00:00.000Z"));
    expect(store.list().backups.map((row) => row.id)).toEqual([second.id, first.id]);
    expect(store.get(first.id).ok).toBe(true);
    expect(store.get("../etc/passwd")).toEqual({ ok: false, error: "invalid" });
    expect(store.remove(first.id)).toBe(true);
    expect(store.list().backups).toHaveLength(1);
  });

  it("prunes automatic and safety backups and never auto-deletes manual ones", () => {
    const dir = mkdtempSync(join(tmpdir(), "nightplot-backups-"));
    const store = new FileBackupStore(dir, 2, 1);
    store.create(backup("11111111-1111-4111-8111-111111111111", "manual", "2026-09-29T00:00:00.000Z"));
    store.create(backup("22222222-2222-4222-8222-222222222222", "pre-apply", "2026-09-29T00:01:00.000Z"));
    store.create(backup("33333333-3333-4333-8333-333333333333", "pre-apply", "2026-09-29T00:02:00.000Z"));
    store.create(backup("44444444-4444-4444-8444-444444444444", "pre-apply", "2026-09-29T00:03:00.000Z"));
    store.create(backup("55555555-5555-4555-8555-555555555555", "pre-restore", "2026-09-29T00:04:00.000Z"));
    store.create(backup("66666666-6666-4666-8666-666666666666", "pre-restore", "2026-09-29T00:05:00.000Z"));
    const listed = store.list().backups;
    expect(listed.filter((row) => row.reason === "manual")).toHaveLength(1);
    expect(listed.filter((row) => row.reason === "pre-apply")).toHaveLength(2);
    expect(listed.filter((row) => row.reason === "pre-restore")).toHaveLength(1);
    expect(listed.find((row) => row.id === "22222222-2222-4222-8222-222222222222")).toBeUndefined();
  });

  it("skips corrupt files instead of listing them as restorable", () => {
    const dir = mkdtempSync(join(tmpdir(), "nightplot-backups-"));
    writeFileSync(join(dir, "cccccccc-cccc-4ccc-8ccc-cccccccccccc.json"), "{not-json");
    const store = new FileBackupStore(dir);
    expect(store.list()).toEqual({ backups: [], skippedInvalid: 1 });
    expect(store.get("cccccccc-cccc-4ccc-8ccc-cccccccccccc")).toEqual({ ok: false, error: "invalid" });
  });
});
