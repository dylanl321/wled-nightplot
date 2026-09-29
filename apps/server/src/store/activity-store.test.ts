import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileActivityStore } from "./activity-store.ts";

describe("Activity store", () => {
  it("persists in newest-first order, filters by Light, and refuses malformed history", () => {
    const path = join(mkdtempSync(join(tmpdir(), "nightplot-activity-")), "activity.json");
    const store = new FileActivityStore(path);
    expect(store.list()).toEqual([]);
    store.append({ id: "one", at: "2026-09-28T00:00:00.000Z", lightId: "a", lightName: "Porch",
      action: "preview", readback: "not-checked", detail: "Preview started" });
    store.append({ id: "two", at: "2026-09-28T00:01:00.000Z", lightId: "b", lightName: "Roof",
      action: "all-off", readback: "unknown", detail: "No answer" });
    expect(new FileActivityStore(path).list().map((row) => row.id)).toEqual(["two", "one"]);
    expect(store.list("a").map((row) => row.id)).toEqual(["one"]);
    const file = JSON.parse(readFileSync(path, "utf8"));
    writeFileSync(path, JSON.stringify({ ...file, entries: [...file.entries, { id: "bad" }] }));
    expect(() => store.list()).toThrow("Invalid Activity history");
    expect(() => store.append({ id: "three", at: "2026-09-28T00:02:00.000Z", lightId: "a",
      lightName: "Porch", action: "apply", readback: "match", detail: "Applied" }))
      .toThrow("Invalid Activity history");
    expect(JSON.parse(readFileSync(path, "utf8")).entries).toHaveLength(3);
  });
});
