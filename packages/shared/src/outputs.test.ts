import { describe, expect, it } from "vitest";
import type { Light } from "./lights.ts";
import {
  legacyOutputId,
  migrateLightOutputs,
  validateDeclaredRangesForLight,
  withMigratedOutputs,
} from "./outputs.ts";

const light: Light = {
  id: "light-yard",
  name: "Yard",
  controllerKind: "wled",
  stripKind: "ws281x",
  hostname: "192.168.1.40",
  port: 80,
  hostKey: "192.168.1.40:80",
  mac: null,
  firmware: "WLED 0.15.4",
  ledCount: 60,
  rgbw: false,
  reachability: "online",
  lastSeenAt: null,
  on: true,
  brightness: 128,
  enrolledAt: "2026-10-31T00:00:00.000Z",
  ledProductId: null,
};

describe("migrateLightOutputs", () => {
  it("synthesizes one output from ledCount on a pre-fleet Light", () => {
    expect(migrateLightOutputs(light)).toEqual([
      {
        id: legacyOutputId(light.id),
        index: 0,
        start: 0,
        ledCount: 60,
        stripKind: "ws281x",
        gpio: null,
        nativeType: null,
        nativeOrder: null,
        colorOrder: null,
      },
    ]);
    expect(withMigratedOutputs(light).outputs).toHaveLength(1);
  });
});

describe("validateDeclaredRangesForLight", () => {
  it("accepts gapped Segments on a migrated single output", () => {
    expect(
      validateDeclaredRangesForLight(
        [
          { id: "a", label: "Roofline", start: 0, stop: 18 },
          { id: "b", label: "Window", start: 30, stop: 48 },
        ],
        withMigratedOutputs(light),
      ),
    ).toEqual([]);
  });

  it("refuses a Segment that leaves its named output", () => {
    const two = withMigratedOutputs({
      ...light,
      ledCount: 100,
      outputs: [
        {
          id: "out-a",
          index: 0,
          start: 0,
          ledCount: 40,
          stripKind: "ws281x",
          gpio: 16,
          nativeType: 22,
          nativeOrder: 0,
          colorOrder: "GRB",
        },
        {
          id: "out-b",
          index: 1,
          start: 40,
          ledCount: 60,
          stripKind: "ws281x",
          gpio: 2,
          nativeType: 22,
          nativeOrder: 0,
          colorOrder: "GRB",
        },
      ],
    });
    const issues = validateDeclaredRangesForLight(
      [{ id: "x", label: "Window", start: 0, stop: 20, outputId: "out-b" }],
      two,
    );
    expect(issues.map((issue) => issue.code)).toContain("over-ledCount");
  });
});
