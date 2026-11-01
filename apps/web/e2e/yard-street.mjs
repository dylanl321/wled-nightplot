/**
 * Street at 1440×900 and 390×844, with Warm white playing.
 * A roofline stands on the front wall, a tree is in front of it, and an
 * arch is off to the side. Street is shot on the Looks page and on Your yard.
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
  const args = ["--no-sandbox", "--disable-dev-shm-usage"];
  try {
    return await chromium.launch({ channel: "chrome", args });
  } catch {
    return await chromium.launch({ args });
  }
}

await ensureStack();
mkdirSync(shots, { recursive: true });
const made = [];
async function prop(body) {
  const created = await api("/api/props", { method: "POST", body: JSON.stringify(body) });
  made.push(created.prop.id);
  return created.prop;
}

let lookSnapshot;
try {
  const eave = await prop({
    label: "Front eave",
    kind: "roofline",
    unit: "m",
    pitchMm: 100,
    measurements: { shape: "roofline", length: 6 },
  });
  await api(`/api/props/${eave.id}/yard`, { method: "PATCH", body: JSON.stringify({ yard: { x: -3, y: 3 } }) });
  const tree = await prop({
    label: "Front tree",
    kind: "tree",
    unit: "m",
    pitchMm: 100,
    measurements: { shape: "tree", height: 1.6, base: 1.2 },
  });
  await api(`/api/props/${tree.id}/yard`, { method: "PATCH", body: JSON.stringify({ yard: { x: 0.4, y: 0, depth: -4 } }) });
  const arch = await prop({
    label: "Side arch",
    kind: "arch",
    unit: "m",
    pitchMm: 100,
    measurements: { shape: "arch", width: 2, height: 2.2 },
  });
  await api(`/api/props/${arch.id}/yard`, { method: "PATCH", body: JSON.stringify({ yard: { x: 3.2, y: 0, depth: 0.4 } }) });

  const before = await api("/api/looks");
  lookSnapshot = { looks: before.looks, playlists: before.playlists, schedule: before.schedule ?? null };
  const warm = lookSnapshot.looks.find((look) => look.name === "Warm white");
  if (!warm) throw new Error("no Warm white Look");
  const looks = lookSnapshot.looks.map((look) => look.id === warm.id
    ? { ...look, propIds: [...new Set([...(look.propIds ?? []), ...made])] }
    : look);
  await api("/api/looks", { method: "PUT", body: JSON.stringify({ ...lookSnapshot, looks }) });

  const browser = await launch();
  try {
    for (const viewport of viewports) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        hasTouch: viewport.touch,
        isMobile: viewport.touch,
      });
      const page = await context.newPage();
      const shoot = async (where) => {
        await page.getByRole("button", { name: "Street" }).click();
        const canvas = page.locator("[data-yard=street]");
        await canvas.waitFor();
        await canvas.scrollIntoViewIfNeeded();
        await page.waitForTimeout(500);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (overflow > 1) throw new Error(`page scrolls sideways by ${overflow}px`);
        const path = join(shots, `yard-street-${where}-${viewport.name}.png`);
        await page.screenshot({ path, fullPage: false });
        console.log(`ok ${where} ${viewport.name} ${path}`);
      };
      await page.goto(`${webOrigin}/looks/${warm.id}`, { waitUntil: "domcontentloaded" });
      await page.getByRole("heading", { name: "Warm white", exact: true }).waitFor({ timeout: 20000 });
      await shoot("looks");
      await page.goto(webOrigin, { waitUntil: "domcontentloaded" });
      await page.getByRole("heading", { name: "Your yard" }).waitFor();
      await shoot("yard");
      await context.close();
    }
  } finally {
    await browser.close();
  }
} finally {
  if (lookSnapshot) await api("/api/looks", { method: "PUT", body: JSON.stringify(lookSnapshot) }).catch(() => {});
  for (const id of made) await api(`/api/props/${id}`, { method: "DELETE" }).catch(() => {});
  stopChildren();
}
