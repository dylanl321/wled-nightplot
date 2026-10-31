import { describe, expect, it } from "vitest";
import { applyNamePattern, validateSetupProfile } from "./setup-profile.ts";

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
});
