/**
 * Fixes from tracing the Well house by hand (epic #182).
 * The wire-in sits on the trace grid, so the first run is as long as the
 * rest. Esc stops tracing. New section always takes the typing. The run
 * tooltip does not follow you out of the prop. A new prop is named after
 * its shape only when no name was typed.
 * Reuses a stack on :43180, or starts one. Nothing is sent to a controller.
 */
import { ensureStack, launch, stopChildren, webOrigin } from "./stack.mjs";

const shots = process.env.NIGHTPLOT_SHOTS ?? null;

function expect(label, ok, detail) {
  if (!ok) throw new Error(`${label}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
}

async function screenOf(page, box, world) {
  const cam = await page.evaluate(() => {
    const yard = window.__yard;
    const wrap = document.querySelector(".stagewrap");
    return { x: yard.cam.x, y: yard.cam.y, ppm: yard.cam.ppm, W: wrap.clientWidth, H: wrap.clientHeight };
  });
  return { x: box.x + (world.x - cam.x) * cam.ppm + cam.W / 2, y: box.y + cam.H / 2 - (world.y - cam.y) * cam.ppm };
}

await ensureStack();
const browser = await launch();
let failed = 0;
try {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await page.goto(`${webOrigin}/?view=new`, { waitUntil: "domcontentloaded" });
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.waitForFunction(() => Boolean(window.__yard?.started));
  expect("a new prop has no name yet", (await page.locator("#ye-name").inputValue()) === "", await page.locator("#ye-name").inputValue());
  await page.getByRole("button", { name: "Draw it" }).click();
  expect("Draw it does not rename it", (await page.locator("#ye-name").inputValue()) === "", await page.locator("#ye-name").inputValue());
  // Feet, so the trace grid is 1 ft.
  await page.evaluate(() => { window.__yard.units = "ft"; });
  const canvas = page.locator(".stagewrap canvas");
  const box = await canvas.boundingBox();
  // An odd spot, well off any grid line.
  await page.mouse.click(box.x + box.width * 0.31 + 7, box.y + box.height * 0.43 + 5);
  await page.waitForFunction(() => window.__yard?.draft?.layout?.corners?.length === 1);
  const wireIn = await page.evaluate(() => window.__yard.draft.layout.corners[0]);
  const foot = 0.3048;
  const onGrid = (v) => Math.abs(v / foot - Math.round(v / foot)) < 1e-6;
  expect("wire-in sits on the 1 ft grid", onGrid(wireIn.x) && onGrid(wireIn.y), wireIn);
  expect("the next run starts Lit", (await page.getByRole("button", { name: "Lit", exact: true }).getAttribute("aria-pressed")) === "true", "Lit not pressed");

  // Two runs of 4 ft on the grid: both read 4' 0".
  for (const step of [{ x: 4, y: 0 }, { x: 4, y: 4 }]) {
    const at = await screenOf(page, box, { x: wireIn.x + step.x * foot + 0.02, y: wireIn.y + step.y * foot - 0.02 });
    await page.mouse.click(at.x, at.y);
  }
  await page.waitForFunction(() => window.__yard.draft.layout.strings[0].run.length === 2);
  const lengths = await page.evaluate(() => {
    const layout = window.__yard.draft.layout;
    const at = (id) => layout.corners.find((c) => c.id === id);
    return layout.strings[0].run.map((r) => Math.hypot(at(r.to).x - at(r.from).x, at(r.to).y - at(r.from).y) / 0.3048);
  });
  expect("first run from the wire-in is 4 ft like the rest", lengths.every((n) => Math.abs(n - 4) < 1e-6), lengths);

  // Esc stops tracing: back to Select, and a click no longer adds a point.
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => window.__yard.tool === "move");
  const far = await screenOf(page, box, { x: wireIn.x + 7 * foot, y: wireIn.y + 2 * foot });
  await page.mouse.click(far.x, far.y);
  await page.waitForTimeout(200);
  const runs = await page.evaluate(() => window.__yard.draft.layout.strings[0].run.length);
  expect("a click after Esc adds nothing", runs === 2, runs);
  if (shots) await page.screenshot({ path: `${shots}/well-esc.png` });

  // The run tooltip clears when the pointer leaves the drawing.
  const mid = await screenOf(page, box, { x: wireIn.x + 2 * foot, y: wireIn.y });
  await page.mouse.move(mid.x, mid.y);
  await page.locator("#ye-hover").waitFor();
  await page.mouse.move(box.x - 40, box.y + 40);
  await page.waitForFunction(() => document.getElementById("ye-hover")?.hidden === true);

  // New section, twice: the name always takes the typing, never the tool keys.
  for (const name of ["Wall 1", "Wall 4"]) {
    await page.getByRole("button", { name: "New section" }).click();
    await page.keyboard.type(name);
    await page.keyboard.press("Enter");
    const state = await page.evaluate(() => ({ tool: window.__yard.tool, names: window.__yard.draft.sections.map((x) => x.name) }));
    expect(`typing ${name} names the section`, state.names.includes(name) && state.tool === "move", state);
    await page.getByRole("button", { name: `Done with ${name}` }).click();
  }
  // Even with focus pulled away, letters do not switch tools while a section is open.
  await page.getByRole("button", { name: "Wall 4" }).click();
  await page.locator(".stagewrap canvas").focus();
  await page.keyboard.press("a");
  expect("letters do not reach the tool keys", (await page.evaluate(() => window.__yard.tool)) === "move", await page.evaluate(() => window.__yard.tool));
  await page.keyboard.press("Escape");

  // Save names it after its shape.
  await page.getByRole("button", { name: "Save and place" }).first().click();
  await page.waitForFunction(() => window.__yard.placing != null);
  const label = await page.evaluate(() => window.__yard.placing.label);
  expect("saved as a Drawing", /^Drawing \d+$/.test(label), label);
  await page.getByRole("button", { name: "Next to the others" }).click();
  await page.waitForFunction(() => window.__yard.placing == null);
  expect("tooltip is gone on the yard", await page.evaluate(() => document.getElementById("ye-hover")?.hidden !== false), "tooltip showing");
  console.log("ok well house fixes");
} catch (error) {
  failed += 1;
  console.error(String(error));
} finally {
  await browser.close();
  stopChildren();
}
if (failed) process.exit(1);
