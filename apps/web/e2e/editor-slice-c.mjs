/**
 * Slice C at 1440×900 (mouse) and 390×844 (touch).
 * Double-click or double-tap a prop card opens the editor.
 * Zoom in until the drawing says it cannot go closer.
 */
import { mkdirSync } from "node:fs";
import { apiOrigin, ensureStack, launch, stopChildren, webOrigin } from "./stack.mjs";

const viewports = [
  { name: "desktop-1440x900", width: 1440, height: 900, touch: false },
  { name: "phone-390x844", width: 390, height: 844, touch: true },
];

function line() {
  const run = [{ id: "e1", from: "c1", to: "c2", kind: "lit" }];
  return {
    source: "trace",
    units: "m",
    pitchM: 0.1,
    startOffsetM: 0,
    corners: [{ id: "c1", x: 0, y: 0 }, { id: "c2", x: 0.1, y: 0 }],
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

mkdirSync("/opt/cursor/artifacts/screenshots", { recursive: true });
await ensureStack();
const browser = await launch();
try {
  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      hasTouch: viewport.touch,
      isMobile: viewport.touch,
    });
    const page = await context.newPage();
    const label = `Slice C ${viewport.name}`;
    const created = await api("/api/props", {
      method: "POST",
      body: JSON.stringify({ label, kind: "roofline", unit: "m", pitchMm: 100, layout: line() }),
    });
    await page.goto(webOrigin, { waitUntil: "domcontentloaded" });
    const title = page.getByText(label, { exact: true });
    await title.waitFor({ timeout: 20000 });
    if (viewport.touch) {
      await title.tap();
      await title.tap();
    } else {
      await title.dblclick();
    }
    await page.waitForURL(/\/props\/.+\/edit/, { timeout: 15000 });
    if (!page.url().includes(created.prop.id)) throw new Error(`${viewport.name}: opened ${page.url()}`);
    const zoom = page.getByRole("button", { name: "Zoom in" });
    await zoom.waitFor();
    for (let step = 0; step < 24; step += 1) await zoom.click();
    await page.getByText("That's as close as it goes.").waitFor({ timeout: 5000 });
    const shot = `/opt/cursor/artifacts/screenshots/slice-c-${viewport.name}.png`;
    await page.screenshot({ path: shot, fullPage: true });
    console.log(shot);
    await context.close();
  }
} finally {
  await browser.close();
  stopChildren();
}
