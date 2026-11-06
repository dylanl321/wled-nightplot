import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Prop } from "@nightplot/shared";
import { createApp } from "./app.ts";
import { FileBackupStore } from "./store/backup-store.ts";
import { InMemoryLightsStore } from "./store/in-memory-lights-store.ts";
import { FileLightsStore, type LightsStore } from "./store/lights-store.ts";
import { FileSettingsStore } from "./store/settings-store.ts";

const stores: [string, (seed?: unknown) => LightsStore][] = [
  ["FileLightsStore", (seed) => {
    const file = join(mkdtempSync(join(tmpdir(), "nightplot-parity-")), "lights.json");
    if (seed !== undefined) writeFileSync(file, JSON.stringify(seed));
    return new FileLightsStore(file);
  }],
  ["InMemoryLightsStore", (seed) => new InMemoryLightsStore(seed)],
];

const edges = [
  { id: "e1", from: "c1", to: "c2", kind: "lit" as const },
  { id: "e2", from: "c2", to: "c3", kind: "lit" as const },
];
function traceLayout(length = 1) {
  return {
    source: "trace" as const, units: "m" as const, pitchM: 0.1, startOffsetM: 0,
    corners: [
      { id: "c1", x: 0, y: 0 }, { id: "c2", x: 0, y: length }, { id: "c3", x: length, y: length },
    ],
    run: edges,
  };
}
const body = (label: string, layout: unknown = traceLayout()) => ({
  label, kind: "custom", unit: "m", pitchMm: 100, layout,
  measurements: { shape: "custom" },
});
const send = (method: string, payload: unknown) => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(payload),
});

function build(store: LightsStore) {
  const dir = mkdtempSync(join(tmpdir(), "nightplot-parity-app-"));
  return createApp({
    store,
    settings: new FileSettingsStore(join(dir, "settings.json")),
    backups: new FileBackupStore(join(dir, "backups")),
    probe: async () => ({ kind: "unreachable" } as never),
    collect: async () => [],
    write: async () => true,
    readLive: async () => null,
    readCfg: async () => null,
    writeCfg: async () => true,
    readNativeFiles: async () => ({ cfgJson: "{}", presetsJson: "{}" }),
    readLedmap: async () => null,
    writeLedmap: async () => {},
    now: () => new Date("2026-10-31T20:00:00.000Z"),
  });
}

type Listing = { props: Prop[]; attachments: unknown[] };
async function list(app: ReturnType<typeof build>) {
  const res = await app.request("/api/props");
  expect(res.status).toBe(200);
  return await res.json() as Listing;
}

describe.each(stores)("prop routes on %s", (_name, make) => {
  it("creates a traced Prop", async () => {
    const app = build(make());
    const res = await app.request("/api/props", send("POST", body("  Porch  ")));
    expect(res.status).toBe(200);
    const made = await res.json() as { prop: Prop; message: string };
    expect(made.prop.id).toBeTruthy();
    expect(made.message).toBeTruthy();
    const listed = await list(app);
    expect(listed.props.map((p) => [p.id, p.label])).toEqual([[made.prop.id, "Porch"]]);
    expect(listed.props[0]!.layout).toEqual(traceLayout());
    expect(listed.attachments).toEqual([]);
  });

  it("trims the label and cuts it at 64 UTF-16 units", async () => {
    const app = build(make());
    const padded = `  ${"a".repeat(62)}🎄${"b".repeat(8)}  `;
    const res = await app.request("/api/props", send("POST", body(padded)));
    expect(res.status).toBe(200);
    const expected = padded.trim().slice(0, 64);
    expect(expected).toHaveLength(64);
    expect((await list(app)).props[0]!.label).toBe(expected);
  });

  it("changes nothing on a refused create", async () => {
    const app = build(make());
    await app.request("/api/props", send("POST", body("Keep")));
    const before = await list(app);
    const noLabel = await app.request("/api/props", send("POST", { ...body("x"), label: "  " }));
    expect([400, 422]).toContain(noLabel.status);
    const badLayout = await app.request("/api/props", send("POST", body("Bad", { source: "trace", corners: "no" })));
    expect([400, 422]).toContain(badLayout.status);
    expect(await list(app)).toEqual(before);
  });

  it("keeps creation order across two creates", async () => {
    const app = build(make());
    const a = await (await app.request("/api/props", send("POST", body("First")))).json() as { prop: Prop };
    const b = await (await app.request("/api/props", send("POST", body("Second")))).json() as { prop: Prop };
    expect(a.prop.id).not.toBe(b.prop.id);
    expect((await list(app)).props.map((p) => p.id)).toEqual([a.prop.id, b.prop.id]);
  });

  it("updates a Prop and keeps its id, position, and LED product", async () => {
    const app = build(make());
    const first = await (await app.request("/api/props", send("POST", { ...body("First"), ledProductId: "product-a" }))).json() as { prop: Prop };
    const second = await (await app.request("/api/props", send("POST", body("Second")))).json() as { prop: Prop };
    expect(first.prop.design?.ledProductId).toBe("product-a");
    const bigger = traceLayout(2);
    const res = await app.request(`/api/props/${first.prop.id}`, send("PATCH", {
      label: "Renamed", kind: "custom", layout: bigger, measurements: { shape: "custom" },
    }));
    expect(res.status).toBe(200);
    const listed = await list(app);
    expect(listed.props.map((p) => p.id)).toEqual([first.prop.id, second.prop.id]);
    expect(listed.props[0]!.label).toBe("Renamed");
    expect(listed.props[0]!.layout).toEqual(bigger);
    expect(listed.props[0]!.design?.ledProductId).toBe("product-a");
  });

  it("answers 404 for an unknown Prop and changes nothing", async () => {
    const app = build(make());
    await app.request("/api/props", send("POST", body("Keep")));
    const before = await list(app);
    const res = await app.request("/api/props/no-such-prop", send("PATCH", { label: "x", layout: traceLayout(2) }));
    expect(res.status).toBe(404);
    expect(await list(app)).toEqual(before);
  });

  it("changes nothing on a refused update", async () => {
    const app = build(make());
    const made = await (await app.request("/api/props", send("POST", body("Keep")))).json() as { prop: Prop };
    const before = await list(app);
    const res = await app.request(`/api/props/${made.prop.id}`, send("PATCH", { layout: { source: "trace", corners: "no" } }));
    expect(res.status).toBe(400);
    expect(await list(app)).toEqual(before);
    expect(before.props[0]!.layout).toEqual(traceLayout());
  });

  it("blocks writes on an unreadable row and leaves the seed unchanged", async () => {
    const seed = { version: 1, lights: [], props: [{ id: 42 }] };
    const store = make(seed);
    const app = build(store);
    const res = await app.request("/api/props", send("POST", body("Nope")));
    expect(res.status).toBe(503);
    expect((await res.json() as { error: string }).error).toBe("store-unreadable");
    const listed = await app.request("/api/props");
    expect(listed.status).toBe(200);
    expect((await listed.json() as Listing).props).toEqual([]);
    if (store.path) expect(readFileSync(store.path, "utf8")).toBe(JSON.stringify(seed));
    // Still blocked after the read.
    expect((await app.request("/api/props", send("POST", body("Nope")))).status).toBe(503);
  });

  it("reads an empty store as empty", async () => {
    const res = await build(make()).request("/api/props");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ props: [], attachments: [] });
  });
});

describe("InMemoryLightsStore only", () => {
  it("refuses both restore routes with 409 restore-unsupported and leaves Props unchanged", async () => {
    const app = build(new InMemoryLightsStore());
    await app.request("/api/props", send("POST", body("Keep")));
    const before = await list(app);
    const backup = await app.request("/api/backups/any/restore", send("POST", {}));
    expect(backup.status).toBe(409);
    expect((await backup.json() as { error: string }).error).toBe("restore-unsupported");
    const season = await app.request("/api/season/restore", send("POST", {}));
    expect(season.status).toBe(409);
    expect((await season.json() as { error: string }).error).toBe("restore-unsupported");
    expect(await list(app)).toEqual(before);
  });
});
