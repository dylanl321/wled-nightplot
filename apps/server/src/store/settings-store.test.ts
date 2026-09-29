import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultNightplotSettings } from "@nightplot/shared";
import { FileSettingsStore } from "./settings-store.ts";

describe("Nightplot preferences", () => {
  it("persists a revision across instances and refuses stale edits", () => {
    const path = join(mkdtempSync(join(tmpdir(), "nightplot-settings-")), "settings.json");
    const first = new FileSettingsStore(path);
    expect(first.read()).toEqual(defaultNightplotSettings());
    const saved = first.save({ ...first.read(), appearance: "light", findIntervalSeconds: 0 });
    expect(saved.settings?.revision).toBe(1);
    expect(new FileSettingsStore(path).read().appearance).toBe("light");
    expect(first.save(defaultNightplotSettings()).error).toBe("conflict");
    expect(JSON.parse(readFileSync(path, "utf8")).findIntervalSeconds).toBe(0);
  });

  it("rejects malformed input without overwriting a valid file", () => {
    const path = join(mkdtempSync(join(tmpdir(), "nightplot-settings-")), "settings.json");
    const store = new FileSettingsStore(path);
    store.save(defaultNightplotSettings());
    expect(store.save({ ...store.read(), palette: [] }).error).toBe("invalid");
    expect(store.read().palette).toHaveLength(8);
  });
});
