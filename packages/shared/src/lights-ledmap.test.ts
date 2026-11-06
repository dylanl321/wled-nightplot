import { describe, expect, it } from "vitest";
import { mergeLastLedmap, normalizeLastLedmap } from "./lights.ts";

describe("lastLedmap", () => {
  it("reads a legacy single { digest, at } as the base map", () => {
    expect(normalizeLastLedmap({ digest: "ledmap1:abc:1k", at: "2026-11-07T00:00:00.000Z" })).toEqual([
      { slot: 0, digest: "ledmap1:abc:1k", at: "2026-11-07T00:00:00.000Z" },
    ]);
  });

  it("keeps a list sorted by slot and drops rows it cannot read", () => {
    expect(normalizeLastLedmap([
      { slot: 2, digest: "b", at: "t" },
      { slot: 0, digest: "a", at: "t" },
      { slot: 0, digest: "dup", at: "t" },
      { slot: 12, digest: "far", at: "t" },
      { slot: 1, digest: 4, at: "t" },
      null,
    ])).toEqual([{ slot: 0, digest: "a", at: "t" }, { slot: 2, digest: "b", at: "t" }]);
  });

  it("is null when nothing was written or nothing is readable", () => {
    expect(normalizeLastLedmap(undefined)).toBeNull();
    expect(normalizeLastLedmap(null)).toBeNull();
    expect(normalizeLastLedmap([])).toBeNull();
    expect(normalizeLastLedmap({ digest: 5 })).toBeNull();
    expect(normalizeLastLedmap("ledmap")).toBeNull();
  });

  it("replaces only the slots just written", () => {
    const merged = mergeLastLedmap(
      { digest: "old0", at: "t0" },
      [{ slot: 1, digest: "new1", at: "t1" }, { slot: 0, digest: "new0", at: "t1" }],
    );
    expect(merged).toEqual([{ slot: 0, digest: "new0", at: "t1" }, { slot: 1, digest: "new1", at: "t1" }]);
    expect(mergeLastLedmap([{ slot: 0, digest: "a", at: "t" }, { slot: 3, digest: "c", at: "t" }], [{ slot: 0, digest: "b", at: "u" }]))
      .toEqual([{ slot: 0, digest: "b", at: "u" }, { slot: 3, digest: "c", at: "t" }]);
  });
});
