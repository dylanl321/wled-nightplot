import { describe, expect, it } from "vitest";
import { estimatePowerScenario } from "./power-budget.ts";

const segments = [
  { id: "left", lightId: "light", label: "Left", start: 0, stop: 10 },
  { id: "right", lightId: "light", label: "Right", start: 20, stop: 30 },
];

describe("power scenario", () => {
  it("estimates independently coloured Segments at chosen brightness and notes uncovered LEDs", () => {
    const scenario = estimatePowerScenario({ segments, ledCount: 40, stripKind: "ws281x", brightness: 128,
      colours: { left: { hex: "#ff0000", white: 0 }, right: { hex: "#ffffff", white: 0 } }, limitMa: 300 });
    expect(scenario?.rows[0]?.milliAmps).toBeCloseTo(100.39, 1);
    expect(scenario?.rows[1]?.milliAmps).toBeCloseTo(301.18, 1);
    expect(scenario?.totalMa).toBeCloseTo(401.57, 1);
    expect(scenario?.aboveLimit).toBe(true);
    expect(scenario?.uncoveredLeds).toBe(20);
  });

  it("models RGBW white separately and never treats zero as a 0 mA safety ceiling", () => {
    const scenario = estimatePowerScenario({ segments: [segments[0]!], ledCount: 10,
      stripKind: "sk6812-rgbw", brightness: 255,
      colours: { left: { hex: "#000000", white: 255 } }, limitMa: 0 });
    expect(scenario?.totalMa).toBe(200);
    expect(scenario?.aboveLimit).toBeNull();
  });

  it("refuses invalid/overlapping ranges, unsupported drivers and missing colour", () => {
    const base = { segments, ledCount: 30, stripKind: "ws281x", brightness: 255,
      colours: { left: { hex: "#ffffff", white: 0 }, right: { hex: "#ffffff", white: 0 } }, limitMa: null };
    expect(estimatePowerScenario({ ...base, segments: [segments[0]!, { ...segments[1]!, start: 5 }] })).toBeNull();
    expect(estimatePowerScenario({ ...base, stripKind: "unsupported" })).toBeNull();
    expect(estimatePowerScenario({ ...base, colours: {} })).toBeNull();
  });
});
