import { describe, expect, it } from "vitest";
import { applyNamePattern, setupProfileTargetIndexes, validateSetupProfile } from "./setup-profile.ts";

describe("applyNamePattern", () => {
  it("fills yard-NN from a 1-based index", () => {
    expect(applyNamePattern("yard-{nn}", { index: 3, currentName: "WLED", host: "192.168.1.9" })).toBe(
      "yard-03",
    );
    expect(applyNamePattern("{name}-{n}", { index: 1, currentName: "Porch", host: "box" })).toBe(
      "Porch-1",
    );
  });
});

describe("validateSetupProfile", () => {
  it("refuses an empty profile", () => {
    expect(validateSetupProfile({ name: "Empty" })).toMatch(/at least one field/);
  });

  it("accepts a naming-only profile", () => {
    expect(validateSetupProfile({ name: "Names", namePattern: "yard-{nn}" })).toBeNull();
  });

  it("accepts a chosen output index", () => {
    expect(validateSetupProfile({ name: "Second bus", ledType: "ws281x", outputIndex: 1 })).toBeNull();
  });
});

describe("setupProfileTargetIndexes", () => {
  it("targets every writable bus when outputIndex is missing or null", () => {
    expect(setupProfileTargetIndexes({}, [0, 1])).toEqual({ ok: true, indexes: [0, 1] });
    expect(setupProfileTargetIndexes({ outputIndex: null }, [0, 2])).toEqual({
      ok: true,
      indexes: [0, 2],
    });
  });

  it("targets one chosen writable bus", () => {
    expect(setupProfileTargetIndexes({ outputIndex: 1 }, [0, 1])).toEqual({
      ok: true,
      indexes: [1],
    });
  });

  it("refuses a bus this Light cannot write", () => {
    const missed = setupProfileTargetIndexes({ outputIndex: 2 }, [0, 1]);
    expect(missed.ok).toBe(false);
    if (missed.ok) return;
    expect(missed.reason).toMatch(/output 3/);
  });
});
