/**
 * Slice A, at 1440×900 with a mouse and 390×844 with a finger:
 * Escape stays in the editor, a click on empty canvas clears the selection,
 * a drag keeps it, and Delete point merges the two runs back into one.
 * Screenshots land in /opt/cursor/artifacts.
 */
import { mkdirSync } from "node:fs";
import { apiOrigin, ensureStack, launch, stopChildren, webOrigin } from "./stack.mjs";

const viewports = [
  { name: "desktop-1440x900", width: 1440, height: 900, touch: false },
  { name: "phone-390x844", width: 390, height: 844, touch: true },
];

function oneRun() {
  const run = [{ id: "e1", from: "c1", to: "c2", kind: "lit", name: "near", lockedLights: 12 }];
  return {
    source: "trace",
    units: "m",
    pitchM: 0.1,
    startOffsetM: 0,
    corners: [{ id: "c1", x: 0, y: 0 }, { id: "c2", x: 2, y: 0 }],
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
    const created = await api("/api/props", {
      method: "POST",
      body: JSON.stringify({ label: `Slice A ${viewport.name}`, kind: "roofline", unit: "m", pitchMm: 100, layout: oneRun() }),
    });
    await page.goto(`${webOrigin}/props/${created.prop.id}/edit`, { waitUntil: "domcontentloaded" });
    const runButton = page.getByRole("button", { name: "A1 · near", exact: true });
    await runButton.waitFor({ timeout: 20000 });
    await runButton.click();
    await page.keyboard.press("Escape");
    if (page.url().includes("step=sections")) throw new Error(`${viewport.name}: Escape left the editor`);
    await page.getByRole("button", { name: "Name sections" }).waitFor();
    const selected = await runButton.evaluate((node) => node.closest("li")?.getAttribute("aria-current"));
    if (selected) throw new Error(`${viewport.name}: Escape left A1 selected`);

    await runButton.click();
    const stage = page.getByTestId("layout-canvas");
    const box = await stage.boundingBox();
    if (!box) throw new Error("no stage");
    // Drag empty space at the top left. The run sits on the drawing, not in this corner.
    const from = { x: box.x + 24, y: box.y + 80 };
    const to = { x: box.x + 120, y: box.y + 140 };
    if (viewport.touch) {
      const cdp = await page.context().newCDPSession(page);
      const point = (x, y) => [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }];
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point(from.x, from.y) });
      for (let step = 1; step <= 8; step += 1) {
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: point(from.x + ((to.x - from.x) * step) / 8, from.y + ((to.y - from.y) * step) / 8),
        });
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await cdp.detach();
    } else {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 8 });
      await page.mouse.up();
    }
    const kept = await runButton.evaluate((node) => node.closest("li")?.getAttribute("aria-current"));
    if (kept !== "true") throw new Error(`${viewport.name}: pan cleared the selection`);

    if (viewport.touch) {
      const cdp = await page.context().newCDPSession(page);
      const point = (x, y) => [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }];
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point(from.x, from.y) });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await cdp.detach();
    } else {
      await page.mouse.click(from.x, from.y);
    }
    const cleared = await runButton.evaluate((node) => node.closest("li")?.getAttribute("aria-current"));
    if (cleared) throw new Error(`${viewport.name}: empty click left A1 selected`);

    await runButton.click();
    await page.getByRole("button", { name: "Add point" }).click();
    await page.getByText(/2 runs/).waitFor();
    const deletePoint = page.getByRole("button", { name: "Delete point" });
    if (await deletePoint.isDisabled()) throw new Error(`${viewport.name}: Delete point stayed disabled`);
    await deletePoint.click();
    await page.getByText("The two runs are now one.").waitFor();
    await page.getByText(/1 run/).waitFor();
    await page.getByRole("status").filter({ hasText: "Saved" }).waitFor({ timeout: 8000 });
    const shot = `/opt/cursor/artifacts/screenshots/slice-a-${viewport.name}.png`;
    await page.screenshot({ path: shot, fullPage: true });
    console.log(shot);
    await context.close();
  }
} finally {
  await browser.close();
  stopChildren();
}
