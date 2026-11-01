/**
 * Yard checks at 1440×900 with a mouse and 390×844 with a finger.
 * An older yard point is only x and y. Depth, facing, and flat stay put
 * when the drawing moves that point. Screenshots land next to the run.
 * Nothing is sent to a controller.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { apiOrigin, ensureStack, stopChildren, webOrigin } from "./stack.mjs";

const viewports = [
  { name: "1440x900", width: 1440, height: 900, touch: false },
  { name: "390x844", width: 390, height: 844, touch: true },
];

const shots = process.env.NIGHTPLOT_SHOTS ?? "/opt/cursor/artifacts/screenshots";

function windowShape() {
  const run = [
    { id: "e1", from: "c1", to: "c2", kind: "lit" },
    { id: "e2", from: "c2", to: "c3", kind: "lit" },
    { id: "e3", from: "c3", to: "c4", kind: "lit" },
    { id: "e4", from: "c4", to: "c1", kind: "lit" },
  ];
  return {
    source: "template",
    units: "m",
    pitchM: 0.1,
    startOffsetM: 0,
    corners: [
      { id: "c1", x: 0, y: 0 },
      { id: "c2", x: 2, y: 0 },
      { id: "c3", x: 2, y: 1.2 },
      { id: "c4", x: 0, y: 1.2 },
    ],
    run,
    strings: [{ id: "s1", startId: "c1", run }],
  };
}

function line() {
  const run = [{ id: "e1", from: "c1", to: "c2", kind: "lit" }];
  return {
    source: "template",
    units: "m",
    pitchM: 0.1,
    startOffsetM: 0,
    corners: [{ id: "c1", x: 0, y: 0 }, { id: "c2", x: 1, y: 0 }],
    run,
    strings: [{ id: "s1", startId: "c1", run }],
  };
}

async function api(path, init) {
  const res = await fetch(`${apiOrigin}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} ${res.status} ${JSON.stringify(body)}`);
  return body;
}

async function launch() {
  const args = [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
  ];
  try {
    return await chromium.launch({ channel: "chrome", args });
  } catch {
    return await chromium.launch({ args });
  }
}

async function show3d(page) {
  const button = page.getByRole("button", { name: "3D" });
  await button.waitFor();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await button.click();
    const view = page.locator("[data-yard-3d=view] canvas");
    const fallback = page.locator("[data-yard-3d=fallback]");
    const opened = await Promise.race([
      view.waitFor({ state: "visible", timeout: 20000 }).then(() => "view"),
      fallback.waitFor({ state: "visible", timeout: 20000 }).then(() => "fallback"),
    ]).catch(() => null);
    if (opened === "fallback") throw new Error(`3D fell back: ${await fallback.innerText()}`);
    if (opened === "view") return;
  }
  throw new Error("3D did not open");
}

async function fits(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 1) throw new Error(`page scrolls sideways by ${overflow}px`);
}

await ensureStack();
mkdirSync(shots, { recursive: true });
const label = `Wall ${Date.now().toString(36)}`;
const created = await api("/api/props", {
  method: "POST",
  body: JSON.stringify({ label, kind: "roofline", unit: "m", pitchMm: 100, layout: line() }),
});
const id = created.prop.id;
let lookSnapshot;

try {
  const older = await api(`/api/props/${id}/yard`, {
    method: "PATCH",
    body: JSON.stringify({ yard: { x: 1.5, y: 2 } }),
  });
  if (JSON.stringify(older.prop.yard) !== JSON.stringify({ x: 1.5, y: 2 })) {
    throw new Error(`older point changed shape ${JSON.stringify(older.prop.yard)}`);
  }

  const placed = await api(`/api/props/${id}/yard`, {
    method: "PATCH",
    body: JSON.stringify({ yard: { x: 1.5, y: 2, depth: 4, facing: 90, mount: "flat", heightM: 0.4 } }),
  });
  const kept = { x: 1.5, y: 2, depth: 4, facing: 90, mount: "flat", heightM: 0.4 };
  if (JSON.stringify(placed.prop.yard) !== JSON.stringify(kept)) {
    throw new Error(`placed point ${JSON.stringify(placed.prop.yard)}`);
  }

  const nudged = await api(`/api/props/${id}/yard`, {
    method: "PATCH",
    body: JSON.stringify({ yard: { x: 2, y: 2 } }),
  });
  if (JSON.stringify(nudged.prop.yard) !== JSON.stringify({ ...kept, x: 2 })) {
    throw new Error(`move dropped the rest ${JSON.stringify(nudged.prop.yard)}`);
  }

  await api(`/api/props/${id}`, { method: "PATCH", body: JSON.stringify({ layout: windowShape() }) });
  await api(`/api/props/${id}/yard`, {
    method: "PATCH",
    body: JSON.stringify({ yard: { x: 0, y: 0.8, depth: 0, facing: 0, mount: "upright", heightM: 0 } }),
  });

  const beforeLooks = await api("/api/looks");
  lookSnapshot = { looks: beforeLooks.looks, playlists: beforeLooks.playlists, schedule: beforeLooks.schedule ?? null };
  const lookName = lookSnapshot.looks[0]?.name;
  if (!lookName) throw new Error("no Look to play");
  const withProp = lookSnapshot.looks.map((look, index) => index === 0
    ? { ...look, propIds: [...new Set([...(look.propIds ?? []), id])] }
    : look);
  await api("/api/looks", { method: "PUT", body: JSON.stringify({ ...lookSnapshot, looks: withProp }) });

  const browser = await launch();
  const written = [];
  try {
    for (const viewport of viewports) {
      await api(`/api/props/${id}/yard`, {
        method: "PATCH",
        body: JSON.stringify({ yard: { x: 0, y: 0.8, depth: 0, facing: 0, mount: "upright", heightM: 0 } }),
      });
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        hasTouch: viewport.touch,
        isMobile: viewport.touch,
      });
      const page = await context.newPage();
      await page.goto(webOrigin, { waitUntil: "domcontentloaded" });
      await page.getByRole("heading", { name: "Your yard" }).waitFor();
      await page.getByText(label, { exact: true }).waitFor();
      await page.getByRole("region", { name: "Yard drawing" }).waitFor();
      await page.getByRole("button", { name: "3D" }).click();
      const canvas = page.locator("[data-yard-3d=view] canvas");
      const fallback = page.locator("[data-yard-3d=fallback]");
      await Promise.race([
        canvas.waitFor({ state: "visible", timeout: 20000 }),
        fallback.waitFor({ state: "visible", timeout: 20000 }),
      ]);
      if (await canvas.count()) {
        await page.locator("[data-yard-ready=yes]").waitFor({ timeout: 15000 });
        await page.getByRole("button", { name: "Street", pressed: true }).waitFor();
        await page.getByRole("button", { name: "Overhead" }).click();
        await page.getByRole("button", { name: "Overhead", pressed: true }).waitFor();
        await page.getByRole("button", { name: "This prop" }).click();
        await page.getByRole("button", { name: "This prop", pressed: true }).waitFor();
        await page.getByRole("button", { name: "Street" }).click();
        await page.getByRole("button", { name: "Street", pressed: true }).waitFor();
        await page.getByRole("button", { name: "2D" }).click();
        const frame = page.getByTestId("yard-stage");
        await frame.locator("canvas").first().waitFor();
        await frame.evaluate((node) => node.scrollIntoView({ block: "center" }));
        const cam = await frame.evaluate((node) => ({ ppm: Number(node.dataset.ppm), ox: Number(node.dataset.ox), oy: Number(node.dataset.oy) }));
        const stage = await frame.boundingBox();
        if (!stage || !cam.ppm) throw new Error("the drawing has no camera");
        await page.mouse.click(stage.x + cam.ox + 0.4 * cam.ppm, stage.y + cam.oy - 1.2 * cam.ppm);
        await page.getByRole("button", { name: "3D" }).click();
        await page.locator("[data-yard-ready=yes]").waitFor();
        await page.getByRole("button", { name: "Turn" }).click();
        await page.getByRole("button", { name: "Lay flat" }).click();
        let moved;
        for (let attempt = 0; attempt < 20; attempt += 1) {
          const listed = await api("/api/props");
          moved = listed.props.find((prop) => prop.id === id)?.yard;
          if (moved?.facing === 45 && moved?.mount === "flat") break;
          await page.waitForTimeout(100);
        }
        if (moved?.facing !== 45 || moved?.mount !== "flat") throw new Error(`3D move did not stick ${JSON.stringify(moved)}`);
        await page.getByLabel("Look").selectOption({ label: lookName });
        await page.getByText("Preview", { exact: true }).waitFor();
        await page.getByRole("button", { name: "Play" }).click();
        await page.getByRole("button", { name: "Stop", pressed: true }).waitFor();
        await page.getByRole("button", { name: "Overhead" }).click();
        await page.getByRole("button", { name: "Overhead", pressed: true }).waitFor();
        const box = await canvas.boundingBox();
        if (box) await page.mouse.dblclick(box.x + box.width * 0.82, box.y + 70);
        await api("/api/yard-scene", {
          method: "PUT",
          body: JSON.stringify({
            house: {
              footprint: [{ x: -3, z: 2 }, { x: 3, z: 2 }, { x: 3, z: 7 }, { x: -3, z: 7 }],
              eaveM: 2.5,
              ridgeM: 1.2,
            },
          }),
        });
        await page.reload({ waitUntil: "load" });
        await page.getByRole("heading", { name: "Your yard" }).waitFor();
        await page.getByRole("button", { name: "2D", pressed: true }).waitFor();
        await show3d(page);
        await page.locator("[data-house=yes]").waitFor();
        await page.locator("[data-yard-ready=yes]").waitFor();
        await page.getByRole("button", { name: "Street" }).click();
        await page.getByRole("button", { name: "Street", pressed: true }).waitFor();
        await page.getByLabel("Look").selectOption({ label: lookName });
        await page.getByText("Preview", { exact: true }).waitFor();
        await page.getByRole("button", { name: "Play" }).click();
        await page.getByRole("button", { name: "Stop", pressed: true }).waitFor();
        await page.waitForTimeout(400);
      }
      await page.getByRole("region", { name: "Yard drawing" }).evaluate((node) => node.scrollIntoView({ block: "start" }));
      await fits(page);
      const path = join(shots, `yard-3d-${viewport.name}.png`);
      await page.screenshot({ path, fullPage: false });
      written.push(path);
      await page.getByRole("button", { name: "2D" }).click();
      await page.getByTestId("yard-stage").waitFor();
      await context.close();
      console.log(`ok ${viewport.name} ${path}`);
    }
  } finally {
    await browser.close();
  }
  console.log(written.join("\n"));
} finally {
  if (lookSnapshot) {
    await api("/api/looks", { method: "PUT", body: JSON.stringify(lookSnapshot) }).catch(() => {});
  }
  await api("/api/yard-scene", { method: "PUT", body: JSON.stringify({ house: null }) }).catch(() => {});
  await api(`/api/props/${id}`, { method: "DELETE" }).catch(() => {});
  stopChildren();
}
