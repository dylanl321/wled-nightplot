/**
 * Phase 1 on the yard page's Draw it canvas.
 * A mouse at 1440×900 draws a 3-run string with one dark run.
 * A finger at 390×844 places a lit point after Draw it is picked.
 * Reuses a stack on :43180, or starts one. Nothing is sent to a controller.
 */
import { mkdirSync } from "node:fs";
import { apiOrigin, ensureStack, launch, stopChildren, webOrigin } from "./stack.mjs";

const shots = "/opt/cursor/artifacts";

function expect(label, ok, detail) {
  if (!ok) throw new Error(`${label}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
}

async function touchTap(page, at) {
  const cdp = await page.context().newCDPSession(page);
  const point = [{ x: at.x, y: at.y, id: 1, radiusX: 4, radiusY: 4, force: 1 }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

async function touchHold(page, at, ms = 560) {
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

/** World metres to page pixels, through the editor camera. */
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

async function corner(page) {
  return page.evaluate(() => {
    const corners = window.__yard.draft.layout.corners;
    const runs = window.__yard.draft.layout.strings?.[0]?.run ?? window.__yard.draft.layout.run ?? [];
    const id = runs.length ? runs[runs.length - 1].to : corners[0].id;
    return corners.find((row) => row.id === id);
  });
}

async function openDraw(page) {
  await page.goto(`${webOrigin}/?view=new`, { waitUntil: "domcontentloaded" });
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.getByRole("button", { name: "Draw it" }).click();
  const { canvas, box } = await canvasBox(page);
  const at = { x: box.x + box.width * 0.4, y: box.y + Math.min(box.height * 0.35, 220) };
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
    const start = await corner(page);
    const second = await screenOf(page, box, { x: start.x + 1, y: start.y });
    await page.mouse.click(second.x, second.y);
    await page.getByRole("button", { name: "A1" }).waitFor();
    const end = await corner(page);
    const hover = await screenOf(page, box, { x: end.x, y: end.y + 1 });
    await page.mouse.move(hover.x, hover.y);
    const hud = page.locator("#ye-trace");
    await page.waitForFunction(() => {
      const node = document.getElementById("ye-trace");
      return Boolean(node && !node.hidden && /A2/.test(node.textContent ?? "") && /10 lights/.test(node.textContent ?? ""));
    });
    await page.screenshot({ path: `${shots}/trace-desktop-mid.png` });
    await page.mouse.click(hover.x, hover.y, { button: "right" });
    await page.getByRole("button", { name: "A2 · dark" }).waitFor();
    await page.keyboard.press("Escape");
    await page.screenshot({ path: `${shots}/trace-desktop-dark.png` });
    const tail = await corner(page);
    const third = await screenOf(page, box, { x: tail.x - 1, y: tail.y });
    await page.mouse.click(third.x, third.y);
    await page.getByRole("button", { name: "A3" }).waitFor();
    const lights = await page.locator("#ye-count").inputValue();
    expect("header count", lights === "20", lights);
    console.log("ok desktop trace");
    const lengthPage = await desktop.newPage();
    const opened = await openDraw(lengthPage);
    await lengthPage.mouse.click(opened.at.x, opened.at.y);
    await lengthPage.waitForFunction(() => window.__yard?.draft?.layout?.corners?.length === 1);
    const origin = await corner(lengthPage);
    const aim = await screenOf(lengthPage, opened.box, { x: origin.x + 2, y: origin.y + 0.05 });
    await lengthPage.mouse.move(aim.x, aim.y);
    await lengthPage.keyboard.type("6' 4\"");
    await lengthPage.locator("#ye-length").waitFor();
    const typed = await lengthPage.locator("#ye-length").inputValue();
    expect("length field", typed === "6' 4\"", typed);
    await lengthPage.waitForFunction(() => {
      const guides = window.__yard?.guides ?? [];
      return guides.some((guide) => guide.kind === "align" || guide.kind === "angle");
    });
    await lengthPage.screenshot({ path: `${shots}/trace-desktop-length.png` });
    await lengthPage.keyboard.press("Enter");
    await lengthPage.waitForFunction(() => (window.__yard?.draft?.layout?.strings?.[0]?.run?.length ?? 0) === 1);
    console.log("ok desktop length");
  } catch (error) {
    failed += 1;
    console.error(String(error));
    await page.screenshot({ path: `${shots}/trace-desktop-failed.png` }).catch(() => {});
  }
  await desktop.close();

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const hand = await phone.newPage();
  try {
    const { box, at } = await openDraw(hand);
    await touchTap(hand, at);
    await hand.waitForFunction(() => window.__yard?.draft?.layout?.corners?.length === 1);
    const start = await corner(hand);
    const next = await screenOf(hand, box, { x: start.x + 0.6, y: start.y });
    await touchTap(hand, next);
    await hand.getByRole("button", { name: "A1" }).waitFor();
    const end = await corner(hand);
    const tailScreen = await screenOf(hand, box, end);
    await hand.evaluate(() => { window.__yard.snapOn = false; });
    const hover = {
      x: Math.min(box.x + box.width - 28, tailScreen.x + 90),
      y: Math.min(box.y + box.height * 0.62, tailScreen.y + 110),
    };
    await hand.mouse.move(hover.x, hover.y);
    await hand.waitForFunction(() => {
      const node = document.getElementById("ye-trace");
      return Boolean(node && !node.hidden && /A2/.test(node.textContent ?? ""));
    });
    await hand.screenshot({ path: `${shots}/trace-phone-mid.png` });
    const lights = await hand.locator("#ye-count").inputValue();
    expect("a finger places a lit run", Number(lights) > 0, lights);
    const undoBox = await hand.locator(".drawundo").boundingBox();
    expect("undo stays reachable", Boolean(undoBox && undoBox.height >= 44 && undoBox.width >= 44), undoBox);
    await touchTap(hand, hover);
    await hand.getByRole("button", { name: "A2" }).waitFor();
    const middle = await hand.evaluate(() => {
      const layout = window.__yard.draft.layout;
      const id = layout.strings[0].run[0].to;
      return layout.corners.find((row) => row.id === id);
    });
    const midAt = await screenOf(hand, box, middle);
    await touchTap(hand, midAt);
    await hand.waitForFunction(() => {
      const bar = document.querySelector(".pointbar");
      return Boolean(window.__yard?.selPoint && bar && !bar.hidden);
    });
    const del = await hand.locator(".pointbar button").boundingBox();
    expect("delete target is 44 px", Boolean(del && del.height >= 44 && del.width >= 44), del);
    await hand.screenshot({ path: `${shots}/trace-phone-selected.png` });
    await hand.locator(".pointbar button").click();
    await hand.locator(".tracetip").getByRole("button", { name: "Undo" }).waitFor();
    await hand.waitForFunction(() => /Merged A1\+A2/.test(document.querySelector(".tracetip")?.textContent ?? ""));
    await hand.screenshot({ path: `${shots}/trace-phone-undo.png` });
    await hand.locator(".tracetip").getByRole("button", { name: "Undo" }).click();
    await hand.getByRole("button", { name: "A2" }).waitFor();
    await hand.evaluate(() => {
      window.__vib = [];
      navigator.vibrate = (pattern) => { window.__vib.push(pattern); return true; };
    });
    const again = await screenOf(hand, box, middle);
    await touchHold(hand, again);
    await hand.waitForFunction(() => /Merged A1\+A2/.test(document.querySelector(".tracetip")?.textContent ?? ""));
    const vib = await hand.evaluate(() => window.__vib);
    expect("long-press vibrates", Array.isArray(vib) && vib.length > 0, vib);
    console.log("ok phone trace");
  } catch (error) {
    failed += 1;
    console.error(String(error));
    await hand.screenshot({ path: `${shots}/trace-phone-failed.png` }).catch(() => {});
  }
  await phone.close();
} finally {
  await browser.close();
  stopChildren();
}

if (failed > 0) {
  console.error(`${failed} trace check(s) failed`);
  process.exit(1);
}
console.log("trace drawing on the yard canvas");
