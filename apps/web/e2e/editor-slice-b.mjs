/**
 * Slice B at 1440×900 (mouse) and 390×844 (touch): a gap is drawn, Add unlit
 * connector closes it, the wire length is next to the lights, and clicking
 * the far run pans it into view. Spacing stays centimetres on a feet prop.
 */
import { mkdirSync } from "node:fs";
import { apiOrigin, ensureStack, launch, stopChildren, webOrigin } from "./stack.mjs";

const viewports = [
  { name: "desktop-1440x900", width: 1440, height: 900, touch: false },
  { name: "phone-390x844", width: 390, height: 844, touch: true },
];

function gapped() {
  const run = [
    { id: "e1", from: "c1", to: "c2", kind: "lit", name: "Wall 1 top" },
    { id: "e2", from: "c3", to: "c4", kind: "lit", name: "Wall 2 top" },
  ];
  return {
    source: "trace",
    units: "ft",
    pitchM: 0.1,
    startOffsetM: 0,
    corners: [
      { id: "c1", x: 0, y: 0 },
      { id: "c2", x: 1.2, y: 0 },
      { id: "c3", x: 1.8, y: 0.4 },
      { id: "c4", x: 3, y: 0.4 },
    ],
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

async function camera(frame) {
  return frame.evaluate((node) => ({ ox: Number(node.dataset.ox), oy: Number(node.dataset.oy), ppm: Number(node.dataset.ppm) }));
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
      body: JSON.stringify({ label: `Slice B ${viewport.name}`, kind: "roofline", unit: "ft", pitchMm: 100, layout: gapped() }),
    });
    await page.goto(`${webOrigin}/props/${created.prop.id}/edit`, { waitUntil: "domcontentloaded" });
    await page.getByText("The wire has a gap.").waitFor({ timeout: 20000 });
    await page.getByLabel("Light spacing (cm)").waitFor();
    const spacing = await page.getByLabel("Light spacing (cm)").inputValue();
    if (spacing !== "10") throw new Error(`${viewport.name}: spacing is ${spacing}, expected 10 cm`);
    await page.getByText(/of wire/).waitFor();
    const stage = page.getByTestId("layout-canvas");
    const before = await camera(stage);
    await page.getByRole("button", { name: "A2 · Wall 2 top", exact: true }).click();
    await page.waitForTimeout(200);
    const after = await camera(stage);
    if (Math.abs(after.ox - before.ox) < 20 && Math.abs(after.oy - before.oy) < 20) {
      throw new Error(`${viewport.name}: clicking A2 did not pan (${JSON.stringify({ before, after })})`);
    }
    const shot = `/opt/cursor/artifacts/screenshots/slice-b-${viewport.name}.png`;
    await page.screenshot({ path: shot, fullPage: true });
    await page.getByRole("button", { name: "Add unlit connector" }).click();
    await page.getByText("Added an unlit connector.").waitFor();
    await page.getByText("The wire has a gap.").waitFor({ state: "hidden" });
    console.log(shot);
    await context.close();
  }
} finally {
  await browser.close();
  stopChildren();
}
