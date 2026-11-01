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

  const browser = await launch();
  const written = [];
  try {
    for (const viewport of viewports) {
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
      await fits(page);
      const path = join(shots, `yard-data-${viewport.name}.png`);
      await page.screenshot({ path, fullPage: true });
      written.push(path);
      await context.close();
      console.log(`ok ${viewport.name} ${path}`);
    }
  } finally {
    await browser.close();
  }
  console.log(written.join("\n"));
} finally {
  await api(`/api/props/${id}`, { method: "DELETE" }).catch(() => {});
  stopChildren();
}
