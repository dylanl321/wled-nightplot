/**
 * A trackpad pinch zooms the drawing, not the page. Runs up and back down
 * one line can each be picked, and Shift-click + Make section groups runs.
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
  await page.getByRole("button", { name: "Draw it" }).click();
  const canvas = page.locator(".stagewrap canvas");
  await canvas.waitFor({ timeout: 20000 });
  const box = await canvas.boundingBox();

  // Pinch: Ctrl + wheel is what Chrome sends for a trackpad pinch on a Mac.
  const before = await page.evaluate(() => window.__yard.cam.ppm);
  const prevented = await page.evaluate(() => {
    const cv = document.querySelector(".stagewrap canvas");
    const r = cv.getBoundingClientRect();
    const ev = new WheelEvent("wheel", { deltaY: -10, ctrlKey: true, clientX: r.left + 200, clientY: r.top + 200, bubbles: true, cancelable: true });
    cv.dispatchEvent(ev);
    const g = new Event("gesturestart", { bubbles: true, cancelable: true });
    cv.dispatchEvent(g);
    cv.dispatchEvent(new Event("gestureend", { bubbles: true, cancelable: true }));
    return { wheel: ev.defaultPrevented, gesture: g.defaultPrevented };
  });
  const after = await page.evaluate(() => window.__yard.cam.ppm);
  expect("pinch is kept off the page", prevented.wheel && prevented.gesture, prevented);
  expect("pinch zooms the drawing", after > before, { before, after });

  // Trace up an edge and back down it, then along the base.
  const at = { x: box.x + box.width * 0.35, y: box.y + Math.min(box.height * 0.6, 420) };
  await page.mouse.click(at.x, at.y);
  await page.waitForFunction(() => window.__yard?.draft?.layout?.corners?.length === 1);
  const c0 = await page.evaluate(() => window.__yard.draft.layout.corners[0]);
  const top = await screenOf(page, box, { x: c0.x, y: c0.y + 1.5 });
  await page.mouse.click(top.x, top.y);
  await page.waitForFunction(() => window.__yard.draft.layout.strings[0].run.length === 1);
  const back = await screenOf(page, box, { x: c0.x, y: c0.y });
  await page.mouse.click(back.x, back.y);
  await page.waitForTimeout(300);
  const runs = await page.evaluate(() => window.__yard.draft.layout.strings[0].run.map((r) => ({ id: r.id, from: r.from, to: r.to })));
  console.log("runs after tracing back down:", JSON.stringify(runs));
  if (runs.length < 2) {
    const right = await screenOf(page, box, { x: c0.x + 1.2, y: c0.y });
    await page.mouse.click(right.x, right.y);
  } else {
    const right = await screenOf(page, box, { x: c0.x + 1.2, y: c0.y });
    await page.mouse.click(right.x, right.y);
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  if (shots) await page.screenshot({ path: `${shots}/shared-line.png` });
  const layout = await page.evaluate(() => window.__yard.draft.layout);
  const edges = layout.strings[0].run;
  console.log("edges:", edges.length, edges.map((e) => `${e.from}->${e.to}`).join(" "));
  expect("traced up and back down", edges.length >= 2, edges);

  // Pick each lane on the shared line with Shift-click.
  await page.getByRole("button", { name: "Select / move" }).click();
  const mid = await screenOf(page, box, { x: c0.x, y: c0.y + 0.75 });
  await page.mouse.click(mid.x - 5, mid.y);
  await page.keyboard.down("Shift");
  await page.mouse.click(mid.x + 5, mid.y);
  await page.keyboard.up("Shift");
  const picked = await page.evaluate(() => window.__yard.selRuns);
  console.log("picked:", picked);
  expect("both runs on the shared line picked", picked.length === 2 && picked[0] !== picked[1], picked);
  await page.getByRole("button", { name: "Make section" }).click();
  await page.waitForTimeout(200);
  const sections = await page.evaluate(() => window.__yard.draft.sections);
  console.log("sections:", JSON.stringify(sections.map((x) => ({ name: x.name, runs: x.edgeIds }))));
  expect("one section with both runs", sections.length === 1 && sections[0].edgeIds.length === 2, sections);

  // Then just the down run into its own section.
  await page.keyboard.press("Escape");
  await page.mouse.click(mid.x + 5, mid.y);
  const one = await page.evaluate(() => window.__yard.selRun);
  await page.mouse.click(mid.x + 5, mid.y, { button: "right" });
  await page.getByRole("menuitem", { name: "Make section" }).click();
  await page.waitForTimeout(200);
  const split = await page.evaluate(() => window.__yard.draft.sections.map((x) => x.edgeIds));
  console.log("after splitting the down run off:", JSON.stringify(split), "picked", one);
  expect("the up and down runs are in separate sections", split.length === 2 && split[0].length === 1 && split[1].length === 1 && split[1][0] === one, split);
  if (shots) await page.screenshot({ path: `${shots}/sections.png` });
  console.log("ok");
} catch (error) {
  failed = 1;
  console.error(error);
} finally {
  await browser.close();
  await stopChildren();
}
process.exit(failed);
