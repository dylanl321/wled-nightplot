import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { recoverInterruptedRestore, writeNightplotStoresConsistent } from "./nightplot-restore.ts";

describe("crash-consistent Nightplot restore", () => {
  it("replaces Lights, LED products and Activity together", () => {
    const dir = mkdtempSync(join(tmpdir(), "nightplot-restore-"));
    const paths = {
      lights: join(dir, "lights.json"),
      products: join(dir, "led-products.json"),
      activity: join(dir, "activity.json"),
    };
    writeFileSync(paths.lights, `${JSON.stringify({ version: 1, lights: [], elements: [] })}\n`);
    writeFileSync(paths.products, `${JSON.stringify({ version: 1, products: [] })}\n`);
    writeFileSync(paths.activity, `${JSON.stringify({ version: 1, entries: [] })}\n`);
    writeNightplotStoresConsistent(paths, {
      lights: [{ id: "porch" } as never],
      elements: [{ id: "door", lightId: "porch", label: "Door", start: 0, stop: 10 }],
      products: [{ id: "ws" } as never],
      activity: [],
    });
    expect(JSON.parse(readFileSync(paths.lights, "utf8")).elements[0].label).toBe("Door");
    expect(JSON.parse(readFileSync(paths.products, "utf8")).products[0].id).toBe("ws");
    expect(JSON.parse(readFileSync(paths.activity, "utf8")).entries).toEqual([]);
  });

  it("finishes a ready intent after a crash between staged files and dest", () => {
    const dir = mkdtempSync(join(tmpdir(), "nightplot-restore-"));
    const dest = join(dir, "lights.json");
    const staged = `${dest}.restore-new`;
    writeFileSync(dest, "old");
    writeFileSync(staged, "new");
    writeFileSync(join(dir, ".nightplot-restore-intent.json"), `${JSON.stringify({
      ready: true, files: [{ dest, staged }],
    })}\n`);
    recoverInterruptedRestore(dest);
    expect(readFileSync(dest, "utf8")).toBe("new");
  });
});
