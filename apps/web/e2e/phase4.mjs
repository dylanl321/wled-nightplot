/**
 * Phase 4: the keys overlay, a pinned run while a neighbour moves, and the
 * touch loupe. Also a short acceptance pass. Nothing is sent to a controller.
 */
import { mkdirSync } from "node:fs";
import { ensureStack, launch, stopChildren, webOrigin } from "./stack.mjs";

const shots = "/opt/cursor/artifacts";

function expect(label, ok, detail) {
  if (!ok) throw new Error(`${label}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
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

async function tail(page) {
  return page.evaluate(() => {
    const layout = window.__yard.draft.layout;
    const run = layout.strings?.[0]?.run ?? [];
    const id = run.length ? run[run.length - 1].to : layout.corners[0].id;
    return layout.corners.find((row) => row.id === id);
  });
}

async function openDraw(page) {
  await page.goto(`${webOrigin}/?view=new`, { waitUntil: "domcontentloaded" });
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.getByRole("button", { name: "Draw it" }).click();
  const { canvas, box } = await canvasBox(page);
  const at = { x: box.x + box.width * 0.32, y: box.y + Math.min(box.height * 0.45, 320) };
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
    const { canvas, box, at } = await openDraw(page);
    await page.mouse.click(at.x, at.y);
    await page.waitForFunction(() => window.__yard?.draft?.layout?.corners?.length === 1);
    const start = await tail(page);
    const second = await screenOf(page, box, { x: start.x + 1.25, y: start.y });
    await page.mouse.click(second.x, second.y);
    await page.getByRole("button", { name: "A1" }).waitFor();
    const mid = await tail(page);
    const third = await screenOf(page, box, { x: mid.x, y: mid.y + 1 });
    await page.mouse.click(third.x, third.y);
    await page.getByRole("button", { name: "A2" }).waitFor();
    await page.keyboard.press("?");
    await page.getByRole("dialog", { name: "Keys" }).waitFor();
    await page.screenshot({ path: `${shots}/phase4-desktop-keys.png` });
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Select / move" }).click();
    await page.getByRole("button", { name: "A1" }).click();
    await page.getByRole("button", { name: "Pin" }).click();
    await page.waitForFunction(() => window.__yard.draft.layout.strings[0].run[0].lengthPinned === true);
    const joint = await page.evaluate(() => window.__yard.draft.layout.corners[1]);
    const onJoint = await screenOf(page, box, joint);
    await page.mouse.move(onJoint.x, onJoint.y);
    await page.mouse.down();
    await page.mouse.move(onJoint.x + 70, onJoint.y - 90);
    const kept = await page.evaluate(() => {
      const layout = window.__yard.draft.layout;
      const a = layout.corners[0];
      const b = layout.corners[1];
      return Math.hypot(b.x - a.x, b.y - a.y);
    });
    expect("pinned run keeps its length", Math.abs(kept - 1.25) < 0.02, kept);
    await page.screenshot({ path: `${shots}/phase4-desktop-pin.png` });
    await page.mouse.up();

    const menuBlocked = await canvas.evaluate((node) => {
      const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
      node.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect("canvas has no browser menu", menuBlocked === true, menuBlocked);
    const fieldBlocked = await page.locator("#ye-name").evaluate((node) => {
      const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
      node.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect("a text field keeps its menu", fieldBlocked === false, fieldBlocked);

    await page.keyboard.press("t");
    await page.keyboard.press("2");
    await page.keyboard.press("4");
    await page.keyboard.press("l");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => {
      const run = window.__yard.draft.layout.strings[0].run;
      return run[run.length - 1].lockedLights === 24;
    });

    await page.goto(`${webOrigin}/?view=new`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Draw it" }).click();
    const fresh = await canvasBox(page);
    const origin = { x: fresh.box.x + fresh.box.width * 0.28, y: fresh.box.y + 220 };
    await page.mouse.click(origin.x, origin.y);
    await page.waitForFunction(() => window.__yard.draft.layout.corners.length === 1);
    for (let index = 0; index < 10; index += 1) {
      const from = await tail(page);
      const next = await screenOf(page, fresh.box, { x: from.x + 0.4, y: from.y + (index % 2 === 0 ? 0.35 : -0.35) });
      await page.mouse.move(next.x, next.y);
      const hud = await page.locator("#ye-trace").textContent();
      const preview = Number(hud?.match(/(\d+) lights/)?.[1]);
      await page.mouse.click(next.x, next.y, { button: index % 2 === 0 ? "left" : "right" });
      await page.waitForFunction((n) => window.__yard.draft.layout.strings[0].run.length === n, index + 1);
      const committed = await page.evaluate(() => {
        const run = window.__yard.draft.layout.strings[0].run;
        const edge = run[run.length - 1];
        const layout = window.__yard.draft.layout;
        const fromCorner = layout.corners.find((row) => row.id === edge.from);
        const toCorner = layout.corners.find((row) => row.id === edge.to);
        return { kind: edge.kind, lights: Math.round(Math.hypot(toCorner.x - fromCorner.x, toCorner.y - fromCorner.y) / layout.pitchM) };
      });
      if (committed.kind === "lit") expect(`run ${index + 1} preview matches`, preview === committed.lights, { preview, committed, hud });
    }
    const kinds = await page.evaluate(() => window.__yard.draft.layout.strings[0].run.map((edge) => edge.kind));
    expect("ten runs", kinds.length === 10, kinds);
    expect("mixed lit and dark", kinds.includes("lit") && kinds.includes("wire"), kinds);
    console.log("ok desktop phase 4");
  } catch (error) {
    failed += 1;
    console.error(String(error));
    await page.screenshot({ path: `${shots}/phase4-desktop-failed.png` }).catch(() => {});
  }
  await desktop.close();

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const hand = await phone.newPage();
  try {
    const { box, at } = await openDraw(hand);
    const cdp = await hand.context().newCDPSession(hand);
    const touch = async (type, point) => {
      const finger = { x: point.x, y: point.y, id: 1, radiusX: 8, radiusY: 8, force: 1 };
      const touchPoints = type === "touchEnd" ? [] : [finger];
      await cdp.send("Input.dispatchTouchEvent", { type, touchPoints });
    };
    await touch("touchStart", at);
    await touch("touchEnd", at);
    await hand.waitForFunction(() => window.__yard?.draft?.layout?.corners?.length === 1);
    const start = await tail(hand);
    const down = await screenOf(hand, box, { x: start.x + 0.2, y: start.y - 0.55 });
    const moved = await screenOf(hand, box, { x: start.x + 0.85, y: start.y - 0.85 });
    await touch("touchStart", down);
    await touch("touchMove", moved);
    const local = { x: moved.x - box.x, y: moved.y - box.y };
    await hand.waitForFunction((point) => {
      const loupe = window.__yard.loupe;
      return Boolean(loupe && Math.hypot(loupe.px - point.x, loupe.py - point.y) < 30);
    }, local);
    await hand.screenshot({ path: `${shots}/phase4-phone-loupe.png` });
    await touch("touchEnd", moved);
    await hand.getByRole("button", { name: "A1" }).waitFor();
    await hand.getByRole("button", { name: "Dark", exact: true }).click();
    const end = await tail(hand);
    const darkAt = await screenOf(hand, box, { x: end.x, y: end.y + 0.45 });
    await touch("touchStart", darkAt);
    await touch("touchEnd", darkAt);
    await hand.waitForFunction(() => window.__yard.draft.layout.strings[0].run.at(-1).kind === "wire");
    await hand.getByRole("button", { name: "Lit", exact: true }).click();
    await hand.locator("#ye-nextlen").click();
    await hand.locator("#ye-nextlen").pressSequentially("24L");
    const spot = { x: box.x + box.width * 0.78, y: box.y + Math.min(box.height * 0.42, 300) };
    await touch("touchStart", spot);
    await touch("touchEnd", spot);
    try {
      await hand.waitForFunction(() => window.__yard.draft.layout.strings[0].run.at(-1).lockedLights === 24, null, { timeout: 8000 });
    } catch (error) {
      const state = await hand.evaluate(() => {
        const run = window.__yard.draft.layout.strings[0].run;
        return { next: document.querySelector("#ye-nextlen")?.value, last: run.at(-1), n: run.length };
      });
      throw new Error(`24L did not land: ${JSON.stringify(state)}`);
    }
    const victim = await hand.evaluate(() => window.__yard.draft.layout.corners[2]);
    const onVictim = await screenOf(hand, box, victim);
    await touch("touchStart", onVictim);
    await hand.waitForTimeout(600);
    await touch("touchEnd", onVictim);
    await hand.waitForFunction(() => window.__yard.draft.layout.corners.length === 3);
    console.log("ok phone phase 4");
    await cdp.detach();
  } catch (error) {
    failed += 1;
    console.error(String(error));
    await hand.screenshot({ path: `${shots}/phase4-phone-failed.png` }).catch(() => {});
  }
  await phone.close();
} finally {
  await browser.close();
  stopChildren();
}

if (failed > 0) {
  console.error(`${failed} phase 4 check(s) failed`);
  process.exit(1);
}
console.log("phase 4 on the yard canvas");
