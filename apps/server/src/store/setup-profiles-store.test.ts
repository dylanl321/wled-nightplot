import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileSetupProfilesStore } from "./setup-profiles-store.ts";

describe("setup profiles store", () => {
  it("treats a missing file as empty and persists a profile", () => {
    const file = join(mkdtempSync(join(tmpdir(), "nightplot-profiles-")), "setup-profiles.json");
    const store = new FileSetupProfilesStore(file);
    expect(store.list()).toEqual([]);
    store.upsert({
      id: "prof-1",
      name: "Yard WS281x",
      ledType: "ws281x",
      namePattern: "yard-{nn}",
    });
    expect(new FileSetupProfilesStore(file).findById("prof-1")).toMatchObject({
      name: "Yard WS281x",
      ledType: "ws281x",
    });
  });
});
