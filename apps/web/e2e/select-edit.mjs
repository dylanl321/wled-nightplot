/**
 * Select mode: a run menu, a box of points, a hover tip, and a phone long-press menu.
 * Reuses a stack on :43180, or starts one. Nothing is sent to a controller.
 */
import { mkdirSync } from "node:fs";
import { ensureStack, launch, stopChildren, webOrigin } from "./stack.mjs";

const shots = "/opt/cursor/artifacts";

function expect(label, ok, detail) {
  if (!ok) throw new Error(`${label}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
}

async function touchHold(page, at, ms = 600) {
  const cdp = await page.context().newCDPSession(page);
  const point = [{ x: at.x, y: at.y, id: 1, radiusX: 4, radiusY: 4, force: 1 }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point });
  await page.waitForTimeout(ms);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

async function canvasBox(page) {
  const canvas = page.locator(".stagewrap canvas");
  await canvas.waitFor({ timeout: 20000 });
  const box = await canvas.boundingBox();
  if (!box) throw new Error("the prop canvas has no box");
  return { canvas, box };
}

async function screenOf(page, box, world) {
  const cam = await page.evaluate(() => {
    const yard = window.__yard;
    const wrap = document.querySelector(".stagewrap");
    return { x: yard.cam.x, y: yard.cam.y, ppm: yard.cam.ppm, W: wrap.clientWidth, H: wrap.clientHeight };
  });
  return {
    x: box.x + (world.x - cam.x) * cam.ppm + cam.W / 2,
    y: box.y + cam.H / 2 - (world.y - cam.y) * cam.ppm,
  };
}

async function corner(page, index) {
  return page.evaluate((at) => {
    const corners = window.__yard.draft.layout.corners;
    const runs = window.__yard.draft.layout.strings?.[0]?.run ?? [];
    if (at == null) {
      const id = runs.length ? runs[runs.length - 1].to : corners[0].id;
      return corners.find((row) => row.id === id);
    }
    return corners[at];
  }, index);
}

async function openDraw(page) {
  await page.goto(`${webOrigin}/?view=new`, { waitUntil: "domcontentloaded" });
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.getByRole("button", { name: "Draw it" }).click();
  const { canvas, box } = await canvasBox(page);
  const at = { x: box.x + box.width * 0.35, y: box.y + Math.min(box.height * 0.42, 280) };
  return { canvas, box, at };
}

mkdirSync(shots, { recursive: true });
await ensureStack();
const browser = await launch();
let failed = 0;
try {
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await desktop.newPage();
  try {
    const { box, at } = await openDraw(page);
    await page.mouse.click(at.x, at.y);
    await page.waitForFunction(() => window.__yard?.draft?.layout?.corners?.length === 1);
    const start = await corner(page, null);
    const second = await screenOf(page, box, { x: start.x + 1.2, y: start.y });
    await page.mouse.click(second.x, second.y);
    await page.getByRole("button", { name: "A1" }).waitFor();
    const mid = await corner(page, null);
    const third = await screenOf(page, box, { x: mid.x, y: mid.y + 1 });
    await page.mouse.click(third.x, third.y);
    await page.getByRole("button", { name: "A2" }).waitFor();
    await page.getByRole("button", { name: "Select / move" }).click();
    const runAt = await screenOf(page, box, { x: (start.x + mid.x) / 2, y: start.y });
    await page.mouse.click(runAt.x, runAt.y, { button: "right" });
    await page.getByRole("menuitem", { name: "Delete run" }).waitFor({ timeout: 5000 });
    await page.screenshot({ path: `${shots}/select-desktop-menu.png` });
    await page.keyboard.press("Escape");
    const corners = await page.evaluate(() => window.__yard.draft.layout.corners);
    const minX = Math.min(...corners.map((row) => row.x)) - 0.45;
    const maxX = Math.max(...corners.map((row) => row.x)) + 0.45;
    const minY = Math.min(...corners.map((row) => row.y)) - 0.45;
    const maxY = Math.max(...corners.map((row) => row.y)) + 0.45;
    const a = await screenOf(page, box, { x: minX, y: maxY });
    const b = await screenOf(page, box, { x: maxX, y: minY });
    expect("box starts on the canvas", a.x > box.x + 8 && a.y > box.y + 8 && a.x < box.x + box.width - 8 && a.y < box.y + box.height - 8, { a, box });
    expect("box ends on the canvas", b.x > box.x + 8 && b.y > box.y + 8 && b.x < box.x + box.width - 8 && b.y < box.y + box.height - 8, { b, box });
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y);
    await page.mouse.up();
    await page.waitForFunction(() => (window.__yard?.selPoints?.length ?? 0) >= 2);
    await page.screenshot({ path: `${shots}/select-desktop-box.png` });
    await page.mouse.move(runAt.x, runAt.y + 6);
    await page.locator("#ye-hover").waitFor();
    await page.screenshot({ path: `${shots}/select-desktop-hover.png` });
    const tip = await page.locator("#ye-hover").textContent();
    expect("hover tip names the run", /A1 · .+ · \d+ lights/.test(tip ?? ""), tip);
    console.log("ok desktop select");
  } catch (error) {
    failed += 1;
    console.error(String(error));
    await page.screenshot({ path: `${shots}/select-desktop-failed.png` }).catch(() => {});
  }
  await desktop.close();

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const hand = await phone.newPage();
  try {
    const { box, at } = await openDraw(hand);
    await hand.evaluate(() => { window.__yard.snapOn = false; });
    const cdpTap = async (point) => {
      const cdp = await hand.context().newCDPSession(hand);
      const touch = [{ x: point.x, y: point.y, id: 1, radiusX: 4, radiusY: 4, force: 1 }];
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: touch });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await cdp.detach();
    };
    await cdpTap(at);
    await hand.waitForFunction(() => window.__yard?.draft?.layout?.corners?.length === 1);
    const start = await corner(hand, null);
    const next = await screenOf(hand, box, { x: start.x + 0.8, y: start.y });
    await cdpTap(next);
    await hand.getByRole("button", { name: "A1" }).waitFor();
    await hand.getByRole("button", { name: "Select" }).click();
    const end = await corner(hand, null);
    const onRun = await screenOf(hand, box, { x: (start.x + end.x) / 2, y: start.y });
    await touchHold(hand, onRun);
    await hand.getByRole("menuitem", { name: "Set length…" }).waitFor();
    await hand.screenshot({ path: `${shots}/select-phone-menu.png` });
    console.log("ok phone select");
  } catch (error) {
    failed += 1;
    console.error(String(error));
    await hand.screenshot({ path: `${shots}/select-phone-failed.png` }).catch(() => {});
  }
  await phone.close();
} finally {
  await browser.close();
  stopChildren();
}

if (failed > 0) {
  console.error(`${failed} select check(s) failed`);
  process.exit(1);
}
console.log("select mode on the yard canvas");
