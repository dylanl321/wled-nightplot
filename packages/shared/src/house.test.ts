import { describe, expect, it } from "vitest";
import { defaultHouse, isYardHouse, snapRoofline } from "./house.ts";

describe("house", () => {
  it("an older yard has no house, and a bad footprint is refused", () => {
    expect(isYardHouse(null)).toBe(false);
    expect(isYardHouse({ footprint: [{ x: 0, z: 0 }], eaveM: 2, ridgeM: 1 })).toBe(false);
    expect(isYardHouse(defaultHouse({ x: 0, z: 0 }))).toBe(true);
  });

  it("snaps a roofline onto the near eave and leaves a far one where it is", () => {
    const house = defaultHouse({ x: 0, z: 0 });
    const near = snapRoofline({ x: 1, y: 0.4, depth: 0.3 }, house);
    expect(near).toEqual({ x: 1, y: 2.5 });
    expect(snapRoofline({ x: 1, y: 0.4, depth: 4 }, house)).toBeNull();
  });
});
