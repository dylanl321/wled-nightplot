import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_LOOKS } from "@nightplot/shared";
import { FileLooksStore } from "./looks-store.ts";
import { StoreUnreadableError } from "./store-error.ts";

describe("looks store", () => {
  it("seeds the default library when the file is missing and does not invent an empty yard", () => {
    const file = join(mkdtempSync(join(tmpdir(), "nightplot-looks-")), "looks.json");
    const store = new FileLooksStore(file);
    expect(store.looks().map((row) => row.name)).toEqual(DEFAULT_LOOKS.map((row) => row.name));
    expect(store.schedule()).toBeNull();
  });

  it("round-trips a saved library", () => {
    const file = join(mkdtempSync(join(tmpdir(), "nightplot-looks-")), "looks.json");
    const store = new FileLooksStore(file);
    const saved = store.save({
      version: 1,
      looks: [{ id: "a", name: "Warm", slot: 1, style: { fx: 0, pal: 0, sx: 1, ix: 1, bri: 40, color: "#ffaa00" }, overrides: [] }],
      playlists: [],
      schedule: null,
    });
    expect(new FileLooksStore(file).looks()).toEqual(saved.looks);
  });

  it("refuses a corrupt file instead of reseeding", () => {
    const file = join(mkdtempSync(join(tmpdir(), "nightplot-looks-")), "looks.json");
    writeFileSync(file, "{not-json", "utf8");
    expect(() => new FileLooksStore(file).read()).toThrow(StoreUnreadableError);
  });
});
