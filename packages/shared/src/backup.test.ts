import { describe, expect, it } from "vitest";
import {
  buildWledBackupFiles,
  deviceCaptureOf,
  reviewWledNativeRestore,
  stripWledBackupSecrets,
  type BackupDocument,
} from "./backup.ts";
import type { Light } from "./lights.ts";

const light = {
  id: "porch",
  name: "Porch",
  hostname: "192.168.1.40",
  port: 80,
  mac: "AA:BB:CC:DD:EE:FF",
  firmware: "WLED 0.15.0",
} as Pick<Light, "id" | "name" | "hostname" | "port" | "mac" | "firmware">;

function backupWithFiles(files: BackupDocument["deviceFiles"]): BackupDocument {
  return {
    version: 1,
    id: "03c75c3e-9846-458e-b458-8739f0bff750",
    at: "2026-09-28T18:00:00.000Z",
    reason: "manual",
    lightId: "porch",
    lightName: "Porch",
    data: { lights: [], elements: [], products: [], activity: [] },
    controller: { hostKey: "192.168.1.40:80", mac: "AA:BB:CC:DD:EE:FF", ledCount: 60,
      reported: { on: true, brightness: 128, segments: [], segmentColor: null } },
    deviceFiles: files,
  };
}

describe("WLED native backup files", () => {
  it("keeps exact bytes when WLED already omitted passwords", () => {
    const raw = '{ "nw": { "ins": [{ "ssid": "Lan", "psk": "" }] } }\n';
    expect(stripWledBackupSecrets(raw)).toEqual({ text: raw, secretsRemoved: false });
  });

  it("removes leftover passwords and records that they were stripped", () => {
    const raw = JSON.stringify({ nw: { ins: [{ ssid: "Lan", psk: "secret" }] }, ota: { pwd: "lock" } });
    const stripped = stripWledBackupSecrets(raw);
    expect(stripped.secretsRemoved).toBe(true);
    expect(stripped.text).not.toContain("secret");
    expect(stripped.text).not.toContain("lock");
    expect(stripped.text).toContain("Lan");
  });

  it("associates opaque files with Light identity, firmware and capture time", () => {
    const files = buildWledBackupFiles({
      cfgJson: '{"id":{"name":"Porch"}}',
      presetsJson: '{"1":{"n":"Warm"}}',
      light,
      liveMac: "AA:BB:CC:DD:EE:FF",
      liveFirmware: "WLED 0.15.0",
      capturedAt: "2026-09-29T00:00:00.000Z",
    });
    expect(files).toMatchObject({
      cfgJson: '{"id":{"name":"Porch"}}',
      presetsJson: '{"1":{"n":"Warm"}}',
      lightId: "porch",
      host: "192.168.1.40:80",
      mac: "AA:BB:CC:DD:EE:FF",
      firmware: "WLED 0.15.0",
      capturedAt: "2026-09-29T00:00:00.000Z",
      secretsRemoved: false,
    });
  });

  it("refuses restore to a different or unknown MAC and asks before a firmware change", () => {
    const files = buildWledBackupFiles({
      cfgJson: "{}",
      presetsJson: "{}",
      light,
      capturedAt: "2026-09-29T00:00:00.000Z",
    });
    const backup = backupWithFiles(files);
    const matched = reviewWledNativeRestore({
      backup, light, liveMac: "AA:BB:CC:DD:EE:FF", liveFirmware: "WLED 0.15.0",
    });
    expect(matched.ok).toBe(true);
    expect(matched.requiresFirmwareConfirm).toBe(false);

    const other = reviewWledNativeRestore({
      backup, light, liveMac: "11:22:33:44:55:66", liveFirmware: "WLED 0.15.0",
    });
    expect(other.ok).toBe(false);
    expect(other.error).toBe("mac-mismatch");

    const firmware = reviewWledNativeRestore({
      backup, light, liveMac: "AA:BB:CC:DD:EE:FF", liveFirmware: "WLED 0.14.4",
    });
    expect(firmware.ok).toBe(true);
    expect(firmware.requiresFirmwareConfirm).toBe(true);

    const missing = reviewWledNativeRestore({
      backup: backupWithFiles(null), light, liveMac: "AA:BB:CC:DD:EE:FF", liveFirmware: "WLED 0.15.0",
    });
    expect(missing.ok).toBe(false);
    expect(missing.error).toBe("missing-device-files");
  });

  it("reports an explicit incomplete capture without treating it as a restore source", () => {
    expect(deviceCaptureOf(backupWithFiles(null))).toEqual({ status: "none", error: null });
    expect(deviceCaptureOf({
      ...backupWithFiles(null),
      deviceCaptureStatus: "incomplete",
      deviceCaptureError: "presets.json returned HTTP 404",
    })).toEqual({ status: "incomplete", error: "presets.json returned HTTP 404" });
  });
});
