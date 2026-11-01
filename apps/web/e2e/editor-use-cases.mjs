/**
 * The editor use cases from docs/editor-plan.md, driven in the real app at
 * 1440×900 with a mouse and 390×844 with a finger:
 *
 *   1. pan and zoom the yard, then Fit;
 *   7. drag a corner, Undo puts it back, Redo puts the move back;
 *  10. set a run to 3 m and read round(3 ÷ spacing) on the run list;
 *  12. add a section, name it, colour it, save, reopen;
 *  13. save a Look that uses that section.
 *
 * Each step uses the visible control (Playwright refuses a control that is
 * covered or off screen) and checks the document, not a screenshot. Nothing
 * here is sent to a controller. Reuses a stack on :43180, or starts one.
 */
import { mkdirSync } from "node:fs";
import { apiOrigin, ensureStack, launch, stopChildren, webOrigin } from "./stack.mjs";

const viewports = [
  { name: "desktop-1440x900", width: 1440, height: 900, touch: false },
  { name: "phone-390x844", width: 390, height: 844, touch: true },
];

const run = Date.now().toString(36);

async function api(path, init) {
  const res = await fetch(`${apiOrigin}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} ${res.status} ${JSON.stringify(body)}`);
  return body;
}

/** An L of two lit runs at 10 cm spacing: 2 m along the ground, then 1 m up. */
function lShape() {
  const run = [
    { id: "e1", from: "c1", to: "c2", kind: "lit" },
    { id: "e2", from: "c2", to: "c3", kind: "lit" },
  ];
  return {
    source: "template",
    units: "m",
    pitchM: 0.1,
    startOffsetM: 0,
    corners: [{ id: "c1", x: 0, y: 0 }, { id: "c2", x: 2, y: 0 }, { id: "c3", x: 2, y: 1 }],
    run,
    strings: [{ id: "s1", startId: "c1", run }],
  };
}

async function newProp(label) {
  const body = await api("/api/props", {
    method: "POST",
    body: JSON.stringify({ label, kind: "roofline", unit: "m", pitchMm: 100, layout: lShape() }),
  });
  return body.prop;
}

/** The stage frame's camera, from the data attributes the stage keeps current. */
async function camera(frame) {
  return frame.evaluate((node) => ({ ppm: Number(node.dataset.ppm), ox: Number(node.dataset.ox), oy: Number(node.dataset.oy) }));
}

async function screenOf(frame, world) {
  const box = await frame.boundingBox();
  const cam = await camera(frame);
  return { x: box.x + cam.ox + world.x * cam.ppm, y: box.y + cam.oy - world.y * cam.ppm };
}

/** One pointer from `from` to `to`: a mouse, or a finger through Chromium's touch input. */
async function drag(page, viewport, from, to, steps = 12) {
  if (!viewport.touch) {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let step = 1; step <= steps; step += 1) {
      await page.mouse.move(from.x + ((to.x - from.x) * step) / steps, from.y + ((to.y - from.y) * step) / steps);
    }
    await page.mouse.up();
    return;
  }
  const cdp = await page.context().newCDPSession(page);
  const point = (x, y) => [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point(from.x, from.y) });
  for (let step = 1; step <= steps; step += 1) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: point(from.x + ((to.x - from.x) * step) / steps, from.y + ((to.y - from.y) * step) / steps),
    });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

/** Two fingers moving apart about `centre`. */
async function pinchOut(page, centre, from = 30, to = 110, steps = 10) {
  const cdp = await page.context().newCDPSession(page);
  const points = (gap) => [
    { x: centre.x - gap, y: centre.y, id: 1, radiusX: 4, radiusY: 4, force: 1 },
    { x: centre.x + gap, y: centre.y, id: 2, radiusX: 4, radiusY: 4, force: 1 },
  ];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points(from) });
  for (let step = 1; step <= steps; step += 1) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: points(from + ((to - from) * step) / steps) });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

/**
 * Wait until React owns this node. A control typed into before hydration
 * keeps the typed value but never tells React, so the edit is lost.
 */
async function hydrated(locator) {
  await locator.first().waitFor({ timeout: 20000 });
  await locator.first().page().waitForFunction(
    (node) => Object.keys(node).some((key) => key.startsWith("__reactProps")),
    await locator.first().elementHandle(),
    { timeout: 20000 },
  );
}

function expect(label, ok, detail) {
  if (!ok) throw new Error(`${label}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
}

async function waitForValue(locator, value, label) {
  try {
    await locator.page().waitForFunction(([node, want]) => node.value === want, [await locator.elementHandle(), value], { timeout: 5000 });
  } catch {
    throw new Error(`${label}: wanted ${value}, read ${await locator.inputValue().catch(() => "nothing")}`);
  }
}

/** A 4 ft run. Stored corners stay in metres. */
function fourFeet() {
  const foot = 0.3048;
  const run = [{ id: "e1", from: "c1", to: "c2", kind: "lit" }];
  return {
    source: "trace",
    units: "ft",
    pitchM: 0.1,
    startOffsetM: 0,
    corners: [{ id: "c1", x: 0, y: 0 }, { id: "c2", x: 4 * foot, y: 0 }],
    run,
    strings: [{ id: "s1", startId: "c1", run }],
  };
}

async function useCaseUnits(page, viewport) {
  const created = await api("/api/props", {
    method: "POST",
    body: JSON.stringify({ label: `Wall ${viewport.name} ${run}`, kind: "roofline", unit: "ft", pitchMm: 100, layout: fourFeet() }),
  });
  const prop = created.prop;
  const stored = (await api("/api/props")).props.find((row) => row.id === prop.id);
  expect("saved prop loads", stored && stored.layout.corners[1].x === fourFeet().corners[1].x && stored.layout.units === "ft", stored?.layout);
  await page.goto(`${webOrigin}/props/${prop.id}/edit`, { waitUntil: "domcontentloaded" });
  const frame = page.getByTestId("layout-canvas");
  await frame.locator("canvas").first().waitFor({ timeout: 20000 });
  const length = page.getByLabel("Run 1 length (ft)");
  await hydrated(length);
  await waitForValue(length, "4'", "units start");
  expect("scale", (await page.getByTestId("grid-scale").innerText()) === "1 square = 1 ft", await page.getByTestId("grid-scale").innerText());
  await waitForValue(page.getByLabel("Light spacing (cm)"), "10", "spacing");
  const foot = 0.3048;
  const from = await screenOf(frame, { x: 4 * foot, y: 0 });
  const to = await screenOf(frame, { x: 1.3, y: 0.04 });
  await drag(page, viewport, from, to, 16);
  await waitForValue(length, "4' 3\"", "units snap");
  mkdirSync("/opt/cursor/artifacts", { recursive: true });
  await page.screenshot({ path: `/opt/cursor/artifacts/editor-units-${viewport.name}.png`, fullPage: true });
  await page.getByRole("button", { name: "Metres" }).click();
  await waitForValue(page.getByLabel("Run 1 length (m)"), "1.30", "units metres");
  await page.getByRole("button", { name: "Feet" }).click();
  await waitForValue(page.getByLabel("Run 1 length (ft)"), "4' 3\"", "units back to feet");
  const after = (await api("/api/props")).props.find((row) => row.id === prop.id);
  expect("unsaved unit change leaves stored corners", after.layout.corners[1].x === fourFeet().corners[1].x, after.layout.corners);
}

async function useCase1(page, viewport) {
  await page.goto(`${webOrigin}/`, { waitUntil: "domcontentloaded" });
  const frame = page.getByTestId("yard-stage");
  await frame.locator("canvas").first().waitFor({ timeout: 20000 });
  await frame.evaluate((node) => node.scrollIntoView({ block: "center" }));
  const fitted = await camera(frame);
  const box = await frame.boundingBox();
  // Pan: drag empty space at the top left. The zoom buttons are top right,
  // and the dev server's own badge sits at the bottom left of the window.
  const from = { x: box.x + 24, y: box.y + 24 };
  await drag(page, viewport, from, { x: from.x + 80, y: from.y + 40 });
  const panned = await camera(frame);
  expect("1 pan", Math.abs(panned.ox - fitted.ox - 80) < 4 && Math.abs(panned.oy - fitted.oy - 40) < 4, { fitted, panned });
  // Zoom: the wheel on a mouse, two fingers on a phone.
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  if (viewport.touch) await pinchOut(page, centre);
  else {
    await page.mouse.move(centre.x, centre.y);
    await page.mouse.wheel(0, -240);
  }
  await page.waitForTimeout(150);
  const zoomed = await camera(frame);
  expect("1 zoom", zoomed.ppm > panned.ppm * 1.2, { panned, zoomed });
  await frame.getByRole("button", { name: "Zoom out" }).click();
  expect("1 zoom out", (await camera(frame)).ppm < zoomed.ppm, await camera(frame));
  await frame.getByRole("button", { name: "Fit" }).click();
  const back = await camera(frame);
  expect("1 fit", Math.abs(back.ppm - fitted.ppm) < 0.01 && Math.abs(back.ox - fitted.ox) < 1 && Math.abs(back.oy - fitted.oy) < 1, { fitted, back });
}

async function useCase7and10(page, viewport, prop) {
  await page.goto(`${webOrigin}/props/${prop.id}/edit`, { waitUntil: "domcontentloaded" });
  const frame = page.getByTestId("layout-canvas");
  await frame.locator("canvas").first().waitFor({ timeout: 20000 });
  const run2 = page.getByLabel("Run 2 length (m)");
  await hydrated(run2);
  await waitForValue(run2, "1.00", "7 start");
  // Drag the end corner from (2, 1) to (2, 2). Snap lands it on the grid.
  const from = await screenOf(frame, { x: 2, y: 1 });
  const to = await screenOf(frame, { x: 2, y: 2 });
  await drag(page, viewport, from, to, 16);
  await waitForValue(run2, "2.00", "7 drag");
  await page.getByRole("button", { name: "Undo" }).first().click();
  await waitForValue(run2, "1.00", "7 undo");
  await page.getByRole("button", { name: "Redo" }).first().click();
  await waitForValue(run2, "2.00", "7 redo");

  // 10: 3 m on run 1 at 10 cm is 30 lights; run 2 keeps its length.
  const run1 = page.getByLabel("Run 1 length (m)");
  await run1.fill("3");
  await run1.press("Enter");
  await waitForValue(page.getByLabel("Run 1 lights"), "30", "10 count");
  await waitForValue(run2, "2.00", "10 later run");
  // Keep the edits for the sections step: the path's Done opens it.
  await page.getByRole("button", { name: "Name sections" }).click();
  await page.getByRole("heading", { name: "Name the sections" }).waitFor();
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForURL(`${webOrigin}/`, { timeout: 10000 }).catch(() => {});
  const saved = (await api("/api/props")).props.find((row) => row.id === prop.id);
  const c2 = saved.layout.corners.find((corner) => corner.id === "c2");
  const c3 = saved.layout.corners.find((corner) => corner.id === "c3");
  expect("10 saved", Math.abs(c2.x - 3) < 1e-6 && Math.abs(c3.y - 2) < 1e-6, saved.layout.corners);
}

async function useCase12(page, prop) {
  const name = `Ridge ${run}`;
  await page.goto(`${webOrigin}/props/${prop.id}/edit?step=sections`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Name the sections" }).waitFor();
  // The drawing only mounts on the client, so once it is up the page is live.
  await page.getByTestId("section-figure").locator("canvas").first().waitFor({ timeout: 20000 });
  await hydrated(page.getByRole("button", { name: "New section" }));
  await page.getByRole("button", { name: "New section" }).click();
  await waitForValue(page.getByLabel("Section name"), `Section ${prop.sections.length + 1}`, "12 new section");
  await page.getByLabel("Section name").fill(name);
  await page.getByLabel("Section colour").fill("#33cc99");
  // Put run 2 on it with the run button beside the drawing.
  const add = page.getByRole("button", { name: /^Add · / }).last();
  await add.click();
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForTimeout(500);
  let saved = (await api("/api/props")).props.find((row) => row.id === prop.id);
  let section = saved.sections.find((row) => row.name === name);
  expect("12 saved", section && section.color === "#33cc99" && section.edgeIds.length === 1, saved.sections);
  // Reopen: still there, still coloured.
  await page.goto(`${webOrigin}/props/${prop.id}/edit?step=sections`, { waitUntil: "domcontentloaded" });
  await hydrated(page.getByRole("button", { name }));
  await page.getByRole("button", { name }).click();
  await waitForValue(page.getByLabel("Section name"), name, "12 reopen name");
  await waitForValue(page.getByLabel("Section colour"), "#33cc99", "12 reopen colour");
  saved = (await api("/api/props")).props.find((row) => row.id === prop.id);
  section = saved.sections.find((row) => row.name === name);
  return section;
}

async function useCase13(page, prop, section) {
  await page.goto(`${webOrigin}/looks`, { waitUntil: "domcontentloaded" });
  await hydrated(page.getByRole("button", { name: /Save|More looks/ }));
  const more = page.getByRole("button", { name: "More looks" });
  if (await more.count()) await more.click();
  const row = `${prop.label} ${section.name}`;
  const colour = page.getByLabel(`${row} colour`);
  if (!(await colour.count())) {
    // The first Look is open by default; open it if a reload closed it.
    await page.locator("ul > li > button").first().click();
  }
  await waitForValue(colour, "#33cc99", "13 section colour default");
  await colour.fill("#ff00aa");
  await page.getByLabel(`${row} effect`).selectOption({ label: "Twinkle" });
  await page.getByRole("button", { name: "Save library" }).click();
  await page.getByText("Saved in Nightplot. Push to write the controllers.").waitFor();
  const library = await api("/api/looks");
  const override = library.looks.flatMap((look) => look.overrides).find((row) => row.propId === prop.id && row.sectionId === section.id);
  expect("13 saved", override && override.style.color === "#ff00aa" && override.style.fx === 17, library.looks[0]?.overrides);
}

await ensureStack();
const browser = await launch();
const original = await api("/api/looks");
let failed = 0;
try {
  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      hasTouch: viewport.touch,
      isMobile: viewport.touch,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    const prop = await newProp(`Porch L ${viewport.name} ${run}`);
    await newProp(`Shed ${viewport.name} ${run}`);
    let section = null;
    for (const [label, step] of [
      ["1 see the yard", () => useCase1(page, viewport)],
      ["units and snap", () => useCaseUnits(page, viewport)],
      ["7 move a corner, 10 set a length", () => useCase7and10(page, viewport, prop)],
      ["12 return to sections", async () => { section = await useCase12(page, prop); }],
      ["13 a Look uses the section", () => (section ? useCase13(page, prop, section) : Promise.reject(new Error("no section from 12")))],
    ]) {
      try {
        await step();
        console.log(`ok ${viewport.name} ${label}`);
      } catch (error) {
        failed += 1;
        console.error(`FAIL ${viewport.name} ${label}\n${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (errors.length) {
      failed += 1;
      console.error(`FAIL ${viewport.name} page errors\n${errors.join("\n")}`);
    }
    await context.close();
  }
} finally {
  // Put the Looks library back the way the run found it.
  await api("/api/looks", {
    method: "PUT",
    body: JSON.stringify({ looks: original.looks, playlists: original.playlists, schedule: original.schedule }),
  }).catch((error) => console.error(`Looks library not restored: ${error}`));
  await browser.close();
  stopChildren();
}

if (failed > 0) {
  console.error(`${failed} editor use case check(s) failed`);
  process.exit(1);
}
console.log("editor use cases pass at 1440×900 and 390×844");
