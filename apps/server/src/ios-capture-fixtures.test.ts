import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  countLayout,
  isPropLayout,
  layoutFromMeasurements,
  spiralLengthM,
  type Prop,
  type PropLayout,
} from "@nightplot/shared";
import { createApp } from "./app.ts";
import { FileBackupStore } from "./store/backup-store.ts";
import { InMemoryLightsStore } from "./store/in-memory-lights-store.ts";
import { FileSettingsStore } from "./store/settings-store.ts";

// Fixtures are written by the iOS LayoutFixtureTests (task 14.5) and only read here.
const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "../../../ios/fixtures/prop-layouts");

type Fixture = {
  request: {
    label: string;
    kind: string;
    unit: string;
    pitchMm: number;
    layout: unknown;
    measurements: Record<string, number | string>;
  };
  layout: PropLayout;
  expectedLightTotal: number;
  litLengthM: number;
};

const files = readdirSync(fixtureDir).filter((name) => name.endsWith(".json")).sort();
const fixtures = files.map((name) => ({
  name,
  fixture: JSON.parse(readFileSync(join(fixtureDir, name), "utf8")) as Fixture,
}));

function build() {
  const dir = mkdtempSync(join(tmpdir(), "nightplot-ios-fixture-"));
  return createApp({
    store: new InMemoryLightsStore(),
    settings: new FileSettingsStore(join(dir, "settings.json")),
    backups: new FileBackupStore(join(dir, "backups")),
    probe: async () => ({ kind: "unreachable" } as never),
    collect: async () => [],
    write: async () => true,
    readLive: async () => null,
    readCfg: async () => null,
    writeCfg: async () => true,
    readNativeFiles: async () => ({ cfgJson: "{}", presetsJson: "{}" }),
    readLedmap: async () => null,
    writeLedmap: async () => {},
    now: () => new Date("2026-10-31T20:00:00.000Z"),
  });
}

function litLengthM(layout: PropLayout): number {
  return countLayout(layout).edges
    .filter((edge) => edge.kind === "lit")
    .reduce((sum, edge) => sum + edge.lengthM, 0);
}

/** Rounds every number to 12 decimals so a last-bit float difference does not fail a deep-equal. */
function roundNumbers(value: unknown): unknown {
  if (typeof value === "number") return Math.round(value * 1e12) / 1e12;
  if (Array.isArray(value)) return value.map(roundNumbers);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, roundNumbers(item)]));
  }
  return value;
}

function spiralParams(measurements: Fixture["request"]["measurements"]) {
  return {
    height: Number(measurements.height),
    around: Number(measurements.around),
    aroundTop: Number(measurements.aroundTop),
    gap: Number(measurements.gap),
  };
}

describe("iOS capture fixtures", () => {
  it("finds the six Swift-written fixtures", () => {
    expect(files).toEqual([
      "backtrack-wire-hidden-ft.json",
      "closed-loop-retired-m.json",
      "one-string-ft.json",
      "spiral-mean-gap-ft.json",
      "spiral-measured-wraps-m.json",
      "two-strings-shared-m.json",
    ]);
  });

  describe.each(fixtures)("$name", ({ name, fixture }) => {
    it("is a valid layout whose count and lit length match the Swift numbers", () => {
      expect(isPropLayout(fixture.layout)).toBe(true);
      expect(isPropLayout(fixture.request.layout)).toBe(true);
      expect(fixture.request.layout).toEqual(fixture.layout);
      expect(countLayout(fixture.layout).total).toBe(fixture.expectedLightTotal);
      expect(Math.abs(litLengthM(fixture.layout) - fixture.litLengthM)).toBeLessThanOrEqual(1e-9);
      void name;
    });

    it("saves through POST /api/props and reads back unchanged", async () => {
      const app = build();
      const res = await app.request("/api/props", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(fixture.request),
      });
      expect(res.status).toBe(200);
      const made = await res.json() as { prop: Prop };
      expect(made.prop.id).toBeTruthy();

      const listed = await app.request("/api/props");
      expect(listed.status).toBe(200);
      const body = await listed.json() as { props: Prop[] };
      const stored = body.props.find((prop) => prop.id === made.prop.id);
      expect(stored).toBeDefined();
      expect(stored!.layout).toEqual(fixture.layout);
    });
  });

  it("measured wraps total within 1% of spiralLengthM for the same spiral", () => {
    const { fixture } = fixtures.find((row) => row.name === "spiral-measured-wraps-m.json")!;
    const p = spiralParams(fixture.request.measurements);
    const expected = spiralLengthM({ heightM: p.height, aroundM: p.around, aroundTopM: p.aroundTop, gapM: p.gap });
    expect(expected).toBeGreaterThan(0);
    expect(Math.abs(litLengthM(fixture.layout) - expected) / expected).toBeLessThan(0.01);
  });

  it("mean-gap layout equals layoutFromMeasurements for the same params", () => {
    const { fixture } = fixtures.find((row) => row.name === "spiral-mean-gap-ft.json")!;
    const built = layoutFromMeasurements({
      units: fixture.layout.units,
      pitchM: fixture.request.pitchMm / 1000,
      shape: "spiral",
      params: spiralParams(fixture.request.measurements),
    });
    expect(built).not.toBeNull();
    // JSON round trip drops undefined keys, as the fixture file does.
    // Swift and TypeScript sum helix steps in the same order but may differ in the last bit.
    expect(roundNumbers(JSON.parse(JSON.stringify(built)))).toEqual(roundNumbers(fixture.layout));
  });
});
