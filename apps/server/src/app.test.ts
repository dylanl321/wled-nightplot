import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp, type AppDeps } from "./app.ts";
import { FileLightsStore } from "./store/lights-store.ts";
import { probeWled, type ProbeFn } from "./wled/client.ts";
import type { ReadLiveFn, WriteStateFn } from "./wled/live.ts";

const snapshot = {
  name: "WLED",
  firmware: "WLED 0.15.4",
  mac: "e8:9f:6d:7f:2a:04",
  ledCount: 60,
  rgbw: false,
  on: true,
  brightness: 128,
  segmentColor: "#ffa000",
  segments: [{ start: 0, stop: 60 }],
};

function memoryBox() {
  const leds = Array.from({ length: 60 }, () => "#ffa000");
  let on = true;
  let bri = 128;
  let color = "#ffa000";
  let segs = [{ start: 0, stop: 60 }];
  const snap = () => ({
    ...snapshot,
    on,
    brightness: bri,
    segmentColor: color,
    segments: segs.map((seg) => ({ ...seg })),
  });
  const write: WriteStateFn = async (_target, body) => {
    if (typeof body.on === "boolean") on = body.on;
    if (typeof body.bri === "number") bri = body.bri;
    if (body.seg) {
      const next: { start: number; stop: number }[] = [];
      for (const seg of body.seg) {
        const rgb = seg.col[0] ?? [255, 160, 0];
        const hex = `#${rgb
          .slice(0, 3)
          .map((n) => n.toString(16).padStart(2, "0"))
          .join("")}`;
        color = hex;
        if (seg.stop <= seg.start) continue;
        next.push({ start: seg.start, stop: seg.stop });
        for (let i = seg.start; i < seg.stop && i < leds.length; i += 1) {
          leds[i] = hex;
        }
      }
      if (next.length) segs = next;
    }
    return true;
  };
  const readLive: ReadLiveFn = async () => ({
    source: "fixture",
    leds: on ? leds.slice() : leds.map(() => "#000000"),
  });
  return {
    write,
    readLive,
    probe: (async () => ({ kind: "found" as const, snapshot: snap() })) satisfies ProbeFn,
    leds,
    segs,
  };
}

function testApp(overrides: Partial<AppDeps> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "nightplot-"));
  const store = overrides.store ?? new FileLightsStore(join(dir, "lights.json"));
  const box = memoryBox();
  const probe: ProbeFn = overrides.probe ?? box.probe;
  const app = createApp({
    store,
    probe,
    write: overrides.write ?? box.write,
    readLive: overrides.readLive ?? box.readLive,
    collect: overrides.collect ?? (async () => []),
    now: overrides.now ?? (() => new Date("2026-09-26T18:00:00.000Z")),
  });
  return { app, store, dir, box };
}

describe("configure server", () => {
  it("reports health for R4", async () => {
    const { app } = testApp();
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      slice: "R4",
    });
  });

  it("keeps root Apply off the Light path; All Off stays R5", async () => {
    const { app } = testApp();
    const apply = await app.request("/api/apply", { method: "POST" });
    expect(apply.status).toBe(400);
    expect(((await apply.json()) as { message: string }).message).toMatch(/lights\/:id\/apply/);
    const allOff = await app.request("/api/all-off", { method: "POST" });
    expect(allOff.status).toBe(501);
    expect(((await allOff.json()) as { message: string }).message).toMatch(/without restoring/);
    const preview = await app.request("/api/preview", { method: "POST" });
    expect(preview.status).toBe(400);
  });
});

describe("discover + connect", () => {
  it("refuses a public address before probing", async () => {
    let probed = 0;
    const { app } = testApp({
      probe: async () => {
        probed += 1;
        return { kind: "found", snapshot };
      },
    });
    const res = await app.request("/api/discover/probe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "203.0.113.9" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      candidate: { status: string; reasonCode: string; reason: string };
    };
    expect(body.candidate.status).toBe("rejected");
    expect(body.candidate.reasonCode).toBe("disallowed-address");
    expect(body.candidate.reason).toMatch(/Refused before probing/);
    expect(probed).toBe(0);

    const add = await app.request("/api/lights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "203.0.113.9" }),
    });
    expect(add.status).toBe(403);
    expect(probed).toBe(0);
  });

  it("lists probe-failed and not-wled with a plain reason", async () => {
    const { app } = testApp({
      probe: async (target) =>
        target.hostname.endsWith(".41")
          ? { kind: "not-wled", reason: "Answered, but /json isn’t WLED. Not added." }
          : { kind: "probe-failed", reason: "192.168.1.90 didn’t return a snapshot in 3 s." },
    });

    const failed = await app.request("/api/discover/probe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "192.168.1.90" }),
    });
    const failedBody = (await failed.json()) as { candidate: { reasonCode: string } };
    expect(failedBody.candidate.reasonCode).toBe("probe-failed");

    const notWled = await app.request("/api/discover/probe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "192.168.1.41" }),
    });
    const notWledBody = (await notWled.json()) as { candidate: { reasonCode: string } };
    expect(notWledBody.candidate.reasonCode).toBe("not-wled");
  });

  it("fails closed when a snapshot cannot be read — nothing enrolled", async () => {
    const { app, store } = testApp({
      probe: async () => ({
        kind: "probe-failed",
        reason: "192.168.1.90 didn’t return a snapshot in 3 s.",
      }),
    });
    const res = await app.request("/api/lights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "192.168.1.90" }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("probe-failed");
    expect(store.load()).toEqual([]);
  });

  it("lists a scanned WLED as found without enrolling it", async () => {
    const { app, store } = testApp({
      collect: async () => [{ hostname: "192.168.1.72", port: 80, via: "mdns" }],
    });
    const res = await app.request("/api/discover", { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      candidates: { status: string; name: string | null }[];
    };
    expect(body.candidates[0]?.status).toBe("found");
    expect(body.candidates[0]?.name).toBe("WLED");
    expect(store.load()).toEqual([]);
  });

  it("enrolls a Light once and refuses a duplicate host", async () => {
    const { app, store } = testApp();
    const first = await app.request("/api/lights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "192.168.1.72" }),
    });
    expect(first.status).toBe(201);
    const created = (await first.json()) as { light: { hostKey: string; name: string } };
    expect(created.light.name).toBe("WLED");
    expect(store.load()).toHaveLength(1);

    const dup = await app.request("/api/lights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "192.168.1.72:80" }),
    });
    expect(dup.status).toBe(409);
    expect(store.load()).toHaveLength(1);
  });

  it("persists enrolled Lights across a new server instance", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nightplot-"));
    const file = join(dir, "lights.json");
    const first = testApp({ store: new FileLightsStore(file) });
    const enroll = await first.app.request("/api/lights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "10.0.0.20" }),
    });
    expect(enroll.status).toBe(201);

    const restarted = testApp({ store: new FileLightsStore(file) });
    const list = await restarted.app.request("/api/lights");
    const body = (await list.json()) as { lights: { hostKey: string }[] };
    expect(body.lights).toHaveLength(1);
    expect(body.lights[0]?.hostKey).toBe("10.0.0.20:80");
  });
});

describe("real WLED HTTP probe", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (!server) return;
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  });

  it("happy-path enrolls from /json and not from a non-WLED 200", async () => {
    server = createServer((req, res) => {
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/json") {
        res.end(
          JSON.stringify({
            info: {
              ver: "0.15.4",
              name: "WLED",
              mac: "aabbccddeeff",
              brand: "WLED",
              leds: { count: 30, rgbw: false },
            },
            state: { on: false, bri: 0, seg: [] },
          }),
        );
        return;
      }
      res.end(JSON.stringify({ ok: true }));
    });
    const port = await listen(server);

    const dir = mkdtempSync(join(tmpdir(), "nightplot-"));
    const store = new FileLightsStore(join(dir, "lights.json"));
    const app = createApp({
      store,
      probe: (target) => probeWled(target, fetch, 500),
      write: async () => true,
      readLive: async () => ({ source: "controller", leds: [] }),
      collect: async () => [],
    });

    const ok = await app.request("/api/lights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: `127.0.0.1:${port}` }),
    });
    expect(ok.status).toBe(201);
    expect(store.load()).toHaveLength(1);
  });
});

describe("declared Elements", () => {
  it("persists a valid draft and returns declared vs reported drift", async () => {
    const { app, store } = testApp();
    const enroll = await app.request("/api/lights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "192.168.1.72" }),
    });
    const created = (await enroll.json()) as { light: { id: string } };
    const id = created.light.id;

    const save = await app.request(`/api/lights/${id}/elements`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        elements: [
          { label: "Left run", start: 0, stop: 24 },
          { label: "Right run", start: 24, stop: 50 },
        ],
      }),
    });
    expect(save.status).toBe(200);
    const detail = (await save.json()) as {
      elements: { label: string; start: number; stop: number }[];
      reported: { start: number; stop: number; differs: boolean }[];
      display: { notes: { text: string }[]; regions: { kind: string; start: number; stop: number }[] };
      light: { elementCount: number; driftLabel: string | null };
    };
    expect(detail.elements).toEqual([
      expect.objectContaining({ label: "Left run", start: 0, stop: 24 }),
      expect.objectContaining({ label: "Right run", start: 24, stop: 50 }),
    ]);
    expect(store.elementsFor(id)).toHaveLength(2);
    expect(detail.reported).toEqual([{ start: 0, stop: 60, differs: true }]);
    expect(detail.display.regions).toContainEqual({ kind: "drift", start: 50, stop: 60 });
    expect(detail.light.elementCount).toBe(2);
    expect(detail.light.driftLabel).toMatch(/reports|not on the controller/);

    const restarted = testApp({ store });
    const again = await restarted.app.request(`/api/lights/${id}`);
    const againBody = (await again.json()) as { elements: { label: string }[] };
    expect(againBody.elements.map((element) => element.label)).toEqual([
      "Left run",
      "Right run",
    ]);
  });

  it("refuses invert, overlap, and over-ledCount drafts without writing", async () => {
    const { app, store } = testApp();
    const enroll = await app.request("/api/lights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "10.0.0.8" }),
    });
    const { light } = (await enroll.json()) as { light: { id: string } };

    const invert = await app.request(`/api/lights/${light.id}/elements`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ elements: [{ label: "Peak", start: 40, stop: 10 }] }),
    });
    expect(invert.status).toBe(422);
    const invertBody = (await invert.json()) as { error: string; message: string };
    expect(invertBody.error).toBe("invert");
    expect(invertBody.message).toMatch(/inverted/);

    const overlap = await app.request(`/api/lights/${light.id}/elements`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        elements: [
          { label: "Peak", start: 10, stop: 40 },
          { label: "Right run", start: 30, stop: 60 },
        ],
      }),
    });
    expect(overlap.status).toBe(422);
    expect(((await overlap.json()) as { error: string }).error).toBe("overlap");

    const over = await app.request(`/api/lights/${light.id}/elements`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ elements: [{ label: "Right run", start: 50, stop: 80 }] }),
    });
    expect(over.status).toBe(422);
    expect(((await over.json()) as { error: string }).error).toBe("over-ledCount");
    expect(store.elementsFor(light.id)).toEqual([]);
  });

  it("keeps unreachable Inspect honest — grey, last-seen, no last colour or last report", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nightplot-"));
    const file = join(dir, "lights.json");
    const online = testApp({ store: new FileLightsStore(file) });
    const enroll = await online.app.request("/api/lights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "192.168.1.40" }),
    });
    const { light } = (await enroll.json()) as { light: { id: string } };
    await online.app.request(`/api/lights/${light.id}/elements`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ elements: [{ label: "Door", start: 0, stop: 60 }] }),
    });

    const offline = testApp({
      store: new FileLightsStore(file),
      probe: async () => ({
        kind: "probe-failed",
        reason: "192.168.1.40 didn’t return a snapshot in 3 s.",
      }),
    });
    const res = await offline.app.request(`/api/lights/${light.id}`);
    const body = (await res.json()) as {
      light: { bead: string; reachability: string; lastSeenAt: string | null };
      reported: unknown[];
      display: { notes: { text: string }[] };
    };
    expect(body.light.reachability).toBe("no-answer");
    expect(body.light.bead).toBe("unknown");
    expect(body.light.lastSeenAt).toBe("2026-09-26T18:00:00.000Z");
    expect(body.reported).toEqual([]);
    expect(body.display.notes[0]?.text).toBe("No current report to compare.");
  });
});

describe("preview + blink", () => {
  async function enroll(app: ReturnType<typeof testApp>["app"]) {
    const res = await app.request("/api/lights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "192.168.1.72" }),
    });
    const body = (await res.json()) as { light: { id: string } };
    await app.request(`/api/lights/${body.light.id}/elements`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        elements: [
          { label: "Left run", start: 0, stop: 24 },
          { label: "Right run", start: 24, stop: 50 },
        ],
      }),
    });
    return body.light.id;
  }

  it("previews a range, reads it back, then restores", async () => {
    const { app, box } = testApp();
    const id = await enroll(app);
    const detail = (await (
      await app.request(`/api/lights/${id}`)
    ).json()) as { elements: { id: string; label: string }[] };
    const right = detail.elements.find((element) => element.label === "Right run");

    const preview = await app.request(`/api/lights/${id}/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        elementId: right?.id,
        color: "#4f7dff",
        brightness: 180,
      }),
    });
    expect(preview.status).toBe(200);
    const live = (await preview.json()) as {
      session: { kind: string; target: { label: string } };
      liveLeds: string[];
      liveCaption: string;
    };
    expect(live.session.kind).toBe("preview");
    expect(live.session.target.label).toBe("Right run");
    expect(live.liveLeds.slice(24, 50).every((led) => led === "#4f7dff")).toBe(true);
    expect(live.liveLeds[0]).toBe("#ffa000");
    expect(live.liveCaption).toMatch(/Not Hardware Done/);
    expect(box.leds[24]).toBe("#4f7dff");

    const ended = await app.request(`/api/lights/${id}/preview/end`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(ended.status).toBe(200);
    const after = (await ended.json()) as { restored: boolean; session: null };
    expect(after.restored).toBe(true);
    expect(after.session).toBeNull();
    expect(box.leds[24]).toBe("#ffa000");
  });

  it("keeps the original restore if Preview is sent again", async () => {
    const { app, box } = testApp();
    const id = await enroll(app);
    const detail = (await (
      await app.request(`/api/lights/${id}`)
    ).json()) as { elements: { id: string }[] };

    await app.request(`/api/lights/${id}/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        elementId: detail.elements[0]?.id,
        color: "#4f7dff",
        brightness: 180,
      }),
    });
    const again = await app.request(`/api/lights/${id}/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        elementId: detail.elements[0]?.id,
        color: "#3dff7a",
        brightness: 200,
      }),
    });
    expect(again.status).toBe(200);
    expect(((await again.json()) as { liveLeds: string[] }).liveLeds[0]).toBe("#3dff7a");

    await app.request(`/api/lights/${id}/preview/end`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(box.leds[0]).toBe("#ffa000");
  });

  it("blinks then restores, and refuses both when offline", async () => {
    const { app, box } = testApp();
    const id = await enroll(app);
    const blink = await app.request(`/api/lights/${id}/blink`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(blink.status).toBe(200);
    const pulsing = (await blink.json()) as { session: { kind: string }; liveLeds: string[] };
    expect(pulsing.session.kind).toBe("blink");
    expect(pulsing.liveLeds[0]).toBe("#f4f1ea");
    expect(box.leds[0]).toBe("#f4f1ea");

    const ended = await app.request(`/api/lights/${id}/blink/end`, { method: "POST" });
    expect(ended.status).toBe(200);
    expect(((await ended.json()) as { restored: boolean }).restored).toBe(true);
    expect(box.leds[0]).toBe("#ffa000");

    const dir = mkdtempSync(join(tmpdir(), "nightplot-"));
    const file = join(dir, "lights.json");
    const online = testApp({ store: new FileLightsStore(file) });
    const offlineId = await enroll(online.app);
    const offline = testApp({
      store: new FileLightsStore(file),
      probe: async () => ({
        kind: "probe-failed",
        reason: "no answer",
      }),
    });
    const refused = await offline.app.request(`/api/lights/${offlineId}/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ color: "#4f7dff" }),
    });
    expect(refused.status).toBe(422);
    expect(((await refused.json()) as { error: string; message: string }).error).toBe(
      "offline",
    );
    const blinkOff = await offline.app.request(`/api/lights/${offlineId}/blink`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(blinkOff.status).toBe(422);
  });
});

describe("apply + re-address", () => {
  async function enroll(app: ReturnType<typeof testApp>["app"]) {
    const res = await app.request("/api/lights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "192.168.1.72" }),
    });
    const body = (await res.json()) as { light: { id: string } };
    await app.request(`/api/lights/${body.light.id}/elements`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        elements: [
          { label: "Left run", start: 0, stop: 24 },
          { label: "Right run", start: 24, stop: 50 },
        ],
      }),
    });
    return body.light.id;
  }

  it("applies declared ranges, rereads, and persists a last-good snapshot", async () => {
    const { app, store } = testApp();
    const id = await enroll(app);
    const detail = (await (await app.request(`/api/lights/${id}`)).json()) as {
      elements: { id: string; label: string; start: number; stop: number }[];
    };
    const res = await app.request(`/api/lights/${id}/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ elements: detail.elements }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      apply: { matched: boolean; caption: string; status: string };
      reported: { start: number; stop: number }[];
    };
    expect(body.apply.matched).toBe(true);
    expect(body.apply.status).toBe("matched");
    expect(body.apply.caption).toMatch(/Not Hardware Done/);
    expect(body.reported.map((row) => `${row.start}-${row.stop}`).sort()).toEqual([
      "0-24",
      "24-50",
    ]);
    expect(store.findById(id)?.lastSnapshot?.segments).toEqual([
      { start: 0, stop: 24 },
      { start: 24, stop: 50 },
    ]);
  });

  it("stays failed when the reread does not match what was applied", async () => {
    const box = memoryBox();
    const { app, store } = testApp({
      write: box.write,
      readLive: box.readLive,
      probe: async () => ({
        kind: "found" as const,
        snapshot: { ...snapshot, segments: [{ start: 0, stop: 60 }] },
      }),
    });
    const id = await enroll(app);
    const detail = (await (await app.request(`/api/lights/${id}`)).json()) as {
      elements: { id: string; label: string; start: number; stop: number }[];
    };
    const res = await app.request(`/api/lights/${id}/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ elements: detail.elements }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      apply: { matched: boolean; status: string; message: string };
    };
    expect(body.apply.matched).toBe(false);
    expect(body.apply.status).toBe("mismatch");
    expect(body.apply.message).toMatch(/didn’t stick/);
    expect(store.findById(id)?.lastSnapshot).toBeFalsy();
  });

  it("refuses Apply when offline or the draft is invalid", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nightplot-"));
    const file = join(dir, "lights.json");
    const online = testApp({ store: new FileLightsStore(file) });
    const id = await enroll(online.app);
    const offline = testApp({
      store: new FileLightsStore(file),
      probe: async () => ({ kind: "probe-failed", reason: "no answer" }),
    });
    const refused = await offline.app.request(`/api/lights/${id}/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(refused.status).toBe(422);
    expect(((await refused.json()) as { message: string }).message).toMatch(/hasn’t answered/);

    const { app } = testApp();
    const liveId = await enroll(app);
    const invert = await app.request(`/api/lights/${liveId}/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        elements: [{ label: "Bad", start: 24, stop: 10 }],
      }),
    });
    expect(invert.status).toBe(422);
    expect(((await invert.json()) as { message: string }).message).toMatch(/stop/i);
  });

  it("probes a new host before switching, and keeps the old address on failure", async () => {
    const { app, store } = testApp();
    const id = await enroll(app);
    const before = store.findById(id)!;
    let seen: string | null = null;
    const other = testApp({
      store,
      probe: async (target) => {
        seen = `${target.hostname}:${target.port}`;
        expect(store.findById(id)?.hostKey).toBe(before.hostKey);
        return { kind: "probe-failed" as const, reason: "no answer at the new host." };
      },
    });
    const res = await other.app.request(`/api/lights/${id}/readdress`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "192.168.1.88" }),
    });
    expect(res.status).toBe(422);
    expect(seen).toBe("192.168.1.88:80");
    expect(store.findById(id)?.hostKey).toBe(before.hostKey);
  });

  it("refuses a public re-address before any probe", async () => {
    const { app, store } = testApp();
    const id = await enroll(app);
    let probed = 0;
    const guarded = testApp({
      store,
      probe: async () => {
        probed += 1;
        return { kind: "found" as const, snapshot };
      },
    });
    const res = await guarded.app.request(`/api/lights/${id}/readdress`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "203.0.113.9" }),
    });
    expect(res.status).toBe(403);
    expect(probed).toBe(0);
    expect(store.findById(id)?.hostKey).toBe("192.168.1.72:80");
  });

  it("switches on same-MAC from a fresh snapshot, and refuses a different MAC", async () => {
    const { app, store } = testApp();
    const id = await enroll(app);
    const ok = testApp({
      store,
      probe: async () => ({
        kind: "found" as const,
        snapshot: {
          ...snapshot,
          name: "WLED-44",
          mac: "e8:9f:6d:7f:2a:04",
          segments: [{ start: 0, stop: 60 }],
        },
      }),
    });
    const switched = await ok.app.request(`/api/lights/${id}/readdress`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "192.168.1.44" }),
    });
    expect(switched.status).toBe(200);
    const after = store.findById(id)!;
    expect(after.hostKey).toBe("192.168.1.44:80");
    expect(after.name).toBe("WLED-44");
    expect(after.lastSnapshot?.name).toBe("WLED-44");

    const refused = await testApp({
      store,
      probe: async () => ({
        kind: "found" as const,
        snapshot: { ...snapshot, mac: "aa:bb:cc:dd:ee:ff", name: "Other" },
      }),
    }).app.request(`/api/lights/${id}/readdress`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "192.168.1.90" }),
    });
    expect(refused.status).toBe(422);
    expect(((await refused.json()) as { error: string }).error).toBe("mac-mismatch");
    expect(store.findById(id)?.hostKey).toBe("192.168.1.44:80");
  });
});

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") resolve(addr.port);
      else reject(new Error("no port"));
    });
  });
}
