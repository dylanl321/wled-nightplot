import { describe, expect, it } from "vitest";
import {
  mergeEffectValues,
  normalizedPosition,
  parseEffectBinding,
  parseEffectDefinition,
  parseEffectDeployment,
  parseEffectExpr,
  sampleBoundEffect,
  sampleEffect,
  sampleEffectAt,
} from "./evaluate.ts";
import { evaluateEffectExpr } from "./expr.ts";

const gradient = {
  version: 1 as const,
  id: "portable-gradient",
  name: "Portable gradient",
  parameters: [
    { id: "speed", label: "Speed", kind: "number" as const, min: 0, max: 4, default: 0.5 },
  ],
  channels: {
    r: "clamp(0.5 + 0.5 * sin(tau * (u - t * speed)), 0, 1)",
    g: "u",
    b: "1 - u",
  },
};

describe("effect contract", () => {
  it("parses a portable definition and refuses a baked node count on the source", () => {
    const definition = parseEffectDefinition(gradient);
    expect(definition?.id).toBe("portable-gradient");
    expect(definition).not.toHaveProperty("nodeCount");
    expect(parseEffectDefinition({ ...gradient, nodeCount: 30 })).toBeNull();
    expect(parseEffectDefinition({ ...gradient, pixels: [] })).toBeNull();
    expect(parseEffectDefinition({ ...gradient, version: 2 })).toBeNull();
    expect(parseEffectDefinition({ ...gradient, channels: { r: "u", g: "u", b: "nope" } })).toBeNull();
    expect(parseEffectDefinition({
      ...gradient,
      parameters: [{ id: "sin", label: "Bad", kind: "number", min: 0, max: 1, default: 0 }],
    })).toBeNull();
  });

  it("parses binding and deployment without copying pixels into the definition", () => {
    expect(parseEffectBinding({
      id: "bind-porch",
      definitionId: "portable-gradient",
      lightId: "light-porch",
      segmentId: "eave",
      values: { speed: 1 },
    })).toEqual({
      id: "bind-porch",
      definitionId: "portable-gradient",
      lightId: "light-porch",
      segmentId: "eave",
      values: { speed: 1 },
    });
    expect(parseEffectDeployment({ id: "deploy-30", bindingId: "bind-porch", nodeCount: 30 })).toEqual({
      id: "deploy-30",
      bindingId: "bind-porch",
      nodeCount: 30,
    });
    expect(parseEffectDeployment({ id: "deploy-0", bindingId: "bind-porch", nodeCount: 0 })).toBeNull();
    expect(parseEffectBinding({
      id: "bind-porch",
      definitionId: "portable-gradient",
      lightId: "light-porch",
      segmentId: "eave",
      values: { speed: "fast" },
    })).toBeNull();
  });
});

describe("restricted expression grammar", () => {
  const allowed = new Set(["u", "t", "i", "n", "pi", "tau", "speed"]);

  it("accepts the documented arithmetic and function set", () => {
    const expr = parseEffectExpr("clamp(mix(0, 1, fract(u + t * speed)), 0, 1)", allowed);
    expect(expr?.type).toBe("call");
    expect(evaluateEffectExpr(expr!, { u: 0.25, t: 0, values: { speed: 0 } })).toBeCloseTo(0.25);
  });

  it("refuses assignment, unknown functions, unknown names, and leftover tokens", () => {
    expect(parseEffectExpr("u = 1", allowed)).toBeNull();
    expect(parseEffectExpr("eval(u)", allowed)).toBeNull();
    expect(parseEffectExpr("foo", allowed)).toBeNull();
    expect(parseEffectExpr("sin(u) t", allowed)).toBeNull();
    expect(parseEffectExpr("sin(u, t)", allowed)).toBeNull();
    expect(parseEffectExpr("", allowed)).toBeNull();
  });

  it("maps division by zero and non-finite math to 0", () => {
    const div = parseEffectExpr("1 / 0", allowed);
    const pow = parseEffectExpr("pow(-1, 0.5)", allowed);
    expect(div && evaluateEffectExpr(div, { u: 0, t: 0, values: {} })).toBe(0);
    expect(pow && evaluateEffectExpr(pow, { u: 0, t: 0, values: {} })).toBe(0);
  });
});

describe("shared evaluator resample", () => {
  it("samples the same Effect at 30 and 150 nodes without rewriting source", () => {
    const before = JSON.stringify(gradient);
    const narrow = sampleEffect({ definition: gradient, nodeCount: 30, timeSec: 1.25 });
    const wide = sampleEffect({ definition: gradient, nodeCount: 150, timeSec: 1.25 });
    expect(JSON.stringify(gradient)).toBe(before);
    expect(narrow?.pixels).toHaveLength(30);
    expect(wide?.pixels).toHaveLength(150);
    expect(narrow?.pixels[0]).toEqual(wide?.pixels[0]);
    expect(narrow?.pixels[29]).toEqual(wide?.pixels[149]);

    for (let index = 0; index < 30; index += 1) {
      const u = normalizedPosition(index, 30);
      expect(u).not.toBeNull();
      expect(sampleEffectAt({ definition: gradient, u: u!, timeSec: 1.25 })).toEqual(narrow?.pixels[index]);
    }
    for (let index = 0; index < 150; index += 1) {
      const u = normalizedPosition(index, 150);
      expect(u).not.toBeNull();
      expect(sampleEffectAt({ definition: gradient, u: u!, timeSec: 1.25 })).toEqual(wide?.pixels[index]);
    }
  });

  it("keeps endpoint colours when resampling 150 down to 30", () => {
    const wide = sampleEffect({ definition: gradient, nodeCount: 150, timeSec: 0 });
    const narrow = sampleEffect({ definition: gradient, nodeCount: 30, timeSec: 0 });
    expect(wide?.pixels[0]).toEqual(narrow?.pixels[0]);
    expect(wide?.pixels[149]).toEqual(narrow?.pixels[29]);
    expect(sampleEffectAt({ definition: gradient, u: 0, timeSec: 0 })).toEqual(narrow?.pixels[0]);
    expect(sampleEffectAt({ definition: gradient, u: 1, timeSec: 0 })).toEqual(narrow?.pixels[29]);
  });

  it("applies binding values through a deployment and refuses a mismatched triple", () => {
    const definition = parseEffectDefinition(gradient);
    const binding = parseEffectBinding({
      id: "bind-porch",
      definitionId: "portable-gradient",
      lightId: "light-porch",
      segmentId: null,
      values: { speed: 2 },
    });
    const deployment = parseEffectDeployment({ id: "deploy-30", bindingId: "bind-porch", nodeCount: 30 });
    const bound = sampleBoundEffect({ definition, binding, deployment, timeSec: 0.5 });
    const direct = sampleEffect({ definition: gradient, nodeCount: 30, timeSec: 0.5, values: { speed: 2 } });
    expect(bound).toEqual(direct);
    expect(sampleBoundEffect({
      definition,
      binding: { ...binding!, definitionId: "other" },
      deployment,
      timeSec: 0.5,
    })).toBeNull();
  });

  it("refuses out-of-range values, bad node counts, and unknown parameters", () => {
    expect(sampleEffect({ definition: gradient, nodeCount: 0, timeSec: 0 })).toBeNull();
    expect(sampleEffect({ definition: gradient, nodeCount: 30.5, timeSec: 0 })).toBeNull();
    expect(sampleEffect({ definition: gradient, nodeCount: 5000, timeSec: 0 })).toBeNull();
    expect(sampleEffect({ definition: gradient, nodeCount: 30, timeSec: Number.NaN })).toBeNull();
    expect(sampleEffect({ definition: gradient, nodeCount: 30, timeSec: 0, values: { speed: 99 } })).toBeNull();
    expect(sampleEffect({ definition: gradient, nodeCount: 30, timeSec: 0, values: { hue: 0.2 } })).toBeNull();
    expect(mergeEffectValues(parseEffectDefinition(gradient)!, { speed: -1 })).toBeNull();
  });

  it("emits optional white and clamps channel output to 0–255", () => {
    const rgbw = parseEffectDefinition({
      version: 1,
      id: "white-wash",
      name: "White wash",
      parameters: [],
      channels: { r: "2", g: "-1", b: "0.5", w: "u" },
    });
    const frame = sampleEffect({ definition: rgbw, nodeCount: 3, timeSec: 0 });
    expect(frame?.pixels[0]).toEqual({ r: 255, g: 0, b: 128, w: 0 });
    expect(frame?.pixels[2]?.w).toBe(255);
  });

  it("uses defaults when a binding omits a parameter", () => {
    const withDefault = sampleEffect({ definition: gradient, nodeCount: 8, timeSec: 0.25 });
    const explicit = sampleEffect({
      definition: gradient,
      nodeCount: 8,
      timeSec: 0.25,
      values: { speed: 0.5 },
    });
    expect(withDefault).toEqual(explicit);
  });
});
