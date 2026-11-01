/**
 * Dylan's eight yard tasks from docs/yard-editor-plan.md, driven on the one
 * yard page at 1440×900 with a mouse and 390×844 with a finger:
 *
 *   1. New prop → Triangle (2 × 2 m) → 60 lights → name it → Save → place it;
 *   2. edit it → Change shape → Window → 2 × 2 m → 80 lights → Save;
 *   3. rename it Box and put it 3 m right of the origin;
 *   4. sections Top (lights 1–40) and Bottom (41–80);
 *   5. open a Look from the yard: it lands on the Look editor at /looks/<id>
 *      (colouring Top and Bottom there is walked by test:looks);
 *   6. zoom in on Box's bottom, tap the run to add a light, Space evenly
 *      again keeps all 81, Save;
 *   7. a 4 m Line with 120 lights, then 100;
 *   8. delete the Line, reload, it stays gone; Undo is checked before that.
 *
 * Each step uses the visible control and checks what the API stored, not a
 * screenshot. Nothing here is sent to a controller. Reuses a stack on :43180,
 * or starts one.
 */
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

function expect(label, ok, detail) {
  if (!ok) throw new Error(`${label}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
}

async function propNamed(label) {
  const { props } = await api("/api/props");
  return props.find((row) => row.label === label) ?? null;
}

/** Count the lights a stored layout carries, from the API's own counting. */
function lightsOf(prop) {
  return prop?.design?.ledCount ?? null;
}

async function waitUntil(label, check, ms = 6000) {
  const deadline = Date.now() + ms;
  let last;
  while (Date.now() < deadline) {
    last = await check();
    if (last === true) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`${label}: ${JSON.stringify(last)}`);
}

/** Wait until React owns the page; a control typed into before hydration loses the edit. */
async function hydrated(page) {
  await page.locator("[data-testid=yard-editor]").waitFor({ timeout: 20000 });
  await page.waitForFunction(() => {
    const node = document.querySelector("[data-testid=yard-editor] canvas");
    return Boolean(node && Object.keys(node).some((key) => key.startsWith("__reactProps")));
  }, null, { timeout: 20000 });
  await page.waitForTimeout(200);
}

async function type(page, selector, value) {
  const field = page.locator(selector);
  await field.click();
  await field.fill(value);
  await field.press("Enter");
}

/** Pick a prop from the list: the rail on desktop, the drawer on a phone. */
async function pick(page, viewport, label) {
  if (viewport.touch) await page.getByRole("button", { name: "Props and Looks" }).click();
  await page.locator(".ye .plist button", { hasText: label }).first().click();
}

async function openYard(page) {
  await page.goto(`${webOrigin}/`, { waitUntil: "domcontentloaded" });
  await hydrated(page);
}

async function task1(page, viewport, name) {
  await openYard(page);
  await page.locator(viewport.touch ? ".ye .insp .newbtn" : ".ye .rail .newbtn").click();
  await page.getByText("A clean canvas").waitFor();
  await page.locator("[data-start=triangle]").click();
  await page.locator("#ye-size-base").waitFor();
  expect("1 starts at 2 m", (await page.locator("#ye-size-base").inputValue()) === "2", await page.locator("#ye-size-base").inputValue());
  await type(page, "#ye-count", "60");
  await type(page, "#ye-name", name);
  await page.locator(".ye .top .btn.primary").click();
  await page.getByRole("heading", { name: `Place ${name}` }).waitFor();
  await page.getByRole("button", { name: "Place here" }).click();
  await page.getByRole("button", { name: "Edit shape" }).waitFor();
  const prop = await propNamed(name);
  expect("1 saved", prop && prop.kind === "tree" && lightsOf(prop) === 60 && prop.yard, prop);
  return prop;
}

async function task2(page, viewport, name) {
  await page.getByRole("button", { name: "Edit shape" }).click();
  await page.getByRole("button", { name: "Change shape" }).click();
  await page.locator("[data-start=window]").click();
  await type(page, "#ye-size-width", "2");
  await type(page, "#ye-size-height", "2");
  await type(page, "#ye-count", "80");
  await page.locator(".ye .top .btn.primary").click();
  await page.getByRole("button", { name: "Edit shape" }).waitFor();
  const prop = await propNamed(name);
  expect("2 square", prop && prop.kind === "window" && lightsOf(prop) === 80, prop);
}

async function task3(page, viewport, name, box) {
  await type(page, "#ye-name", box);
  await type(page, "#ye-x", "3");
  await type(page, "#ye-y", "0");
  await waitUntil("3 stored", async () => {
    const prop = await propNamed(box);
    return prop?.yard?.x === 3 && prop.yard.y === 0 ? true : prop?.yard ?? `no prop ${box}`;
  });
}

async function task4(page, viewport, box) {
  await page.getByRole("button", { name: "Edit shape" }).click();
  for (const [section, runs] of [["Top", [2, 3]], ["Bottom", [0, 1]]]) {
    await page.getByRole("button", { name: "New section" }).click();
    await type(page, "#ye-secname", section);
    // With a section open, each run row adds that run to it.
    const rows = page.locator(".ye [data-run]");
    for (const index of runs) await rows.nth(index).click();
    await page.getByRole("button", { name: `Done with ${section}` }).click();
  }
  await page.locator(".ye .top .btn.primary").click();
  await page.getByRole("button", { name: "Edit shape" }).waitFor();
  const prop = await propNamed(box);
  const names = (prop?.sections ?? []).map((row) => `${row.name}:${row.edgeIds.length}`);
  expect("4 sections", names.join(",") === "Top:2,Bottom:2", names);
  return prop;
}

async function task5(page, viewport, prop, look) {
  if (viewport.touch) await page.getByRole("button", { name: "Props and Looks" }).click();
  await page.locator(".ye .plist a", { hasText: look.name }).first().click();
  await page.waitForURL(new RegExp(`/looks/${look.id}`));
  await page.getByRole("heading", { name: look.name, exact: true }).waitFor({ timeout: 20000 });
  await openYard(page);
  await pick(page, viewport, prop.label);
  await page.getByRole("button", { name: "Edit shape" }).waitFor();
}

/** Two fingers spread apart around a point, the way a phone zooms in. */
async function pinchOut(page, at) {
  const cdp = await page.context().newCDPSession(page);
  const points = (gap) => [
    { x: at.x - gap, y: at.y, id: 0 },
    { x: at.x + gap, y: at.y, id: 1 },
  ];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points(30) });
  for (let gap = 35; gap <= 60; gap += 5) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: points(gap) });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
  await page.waitForTimeout(150);
}

async function task6(page, viewport, prop) {
  await page.getByRole("button", { name: "Edit shape" }).click();
  await page.locator(".ye [data-run]").first().click();
  // Centre the camera on the picked run, close enough that each light is a numbered dot.
  const runId = await page.evaluate(() => {
    const s = window.__yard;
    const layout = s.draft.layout;
    const edge = layout.strings?.flatMap((row) => row.run).find((row) => row.id === s.selRun) ?? layout.run.find((row) => row.id === s.selRun);
    const a = layout.corners.find((c) => c.id === edge.from);
    const b = layout.corners.find((c) => c.id === edge.to);
    s.cam = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, ppm: 400 };
    return edge.id;
  });
  const box = await page.locator(".ye .stagewrap canvas").boundingBox();
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  if (viewport.touch) await pinchOut(page, at);
  else await page.getByRole("button", { name: "Zoom in" }).click();
  if (viewport.touch) await page.touchscreen.tap(at.x, at.y);
  else await page.mouse.click(at.x, at.y);
  await waitUntil("6 light added", async () => page.evaluate((id) => {
    const s = window.__yard;
    const edge = (s.draft.layout.strings?.flatMap((row) => row.run) ?? s.draft.layout.run).find((row) => row.id === id);
    return edge?.manualLights === true && edge.lights?.length === 21 ? true : { manualLights: edge?.manualLights, n: edge?.lights?.length, sel: s.selRun };
  }, runId));
  await page.getByRole("button", { name: "Space evenly again" }).click();
  await page.locator(".ye .top .btn.primary").click();
  await page.getByRole("button", { name: "Edit shape" }).waitFor();
  const stored = await propNamed(prop.label);
  expect("6 Space evenly keeps the added light", lightsOf(stored) === 81, lightsOf(stored));
  const edge = (stored.layout.strings?.flatMap((row) => row.run) ?? stored.layout.run).find((row) => row.id === runId);
  expect("6 run spaced evenly with 21", edge && !edge.manualLights && edge.lockedLights === 21, edge);
}

async function task7(page, viewport, line) {
  // A prop is still selected, so on a phone New prop is in the drawer.
  if (viewport.touch) await page.getByRole("button", { name: "Props and Looks" }).click();
  await page.locator(".ye .rail .newbtn").click();
  await page.locator("[data-start=line]").click();
  await type(page, "#ye-size-length", "4");
  await type(page, "#ye-count", "120");
  await type(page, "#ye-name", line);
  await page.locator(".ye .top .btn.primary").click();
  await page.getByRole("button", { name: "Next to the others" }).click();
  await page.getByRole("button", { name: "Edit shape" }).click();
  await type(page, "#ye-count", "100");
  await page.locator(".ye .top .btn.primary").click();
  await page.getByRole("button", { name: "Edit shape" }).waitFor();
  const prop = await propNamed(line);
  expect("7 line", prop && prop.kind === "roofline" && lightsOf(prop) === 100, prop);
}

async function task8(page, viewport, line) {
  await page.getByRole("button", { name: "Delete" }).click();
  await page.locator(".ye .confirm .btn.danger").click();
  await waitUntil("8 deleted", async () => ((await propNamed(line)) ? "still there" : true));
  await page.getByRole("button", { name: "Undo" }).click();
  await waitUntil("8 undo brings it back", async () => ((await propNamed(line))?.yard ? true : "not back"));
  await pick(page, viewport, line);
  await page.getByRole("button", { name: "Delete" }).click();
  await page.locator(".ye .confirm .btn.danger").click();
  await waitUntil("8 deleted again", async () => ((await propNamed(line)) ? "still there" : true));
  await openYard(page);
  expect("8 gone after reload", (await page.locator(".ye .plist button", { hasText: line }).count()) === 0, "listed");
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
    const tag = `${viewport.touch ? "phone" : "desk"} ${run}`;
    const name = `X ${tag}`;
    const box = `Box ${tag}`;
    const line = `Line ${tag}`;
    let sectioned = null;
    for (const [label, step] of [
      ["1 triangle, 60 lights, placed", () => task1(page, viewport, name)],
      ["2 change it to an 80-light square", () => task2(page, viewport, name)],
      ["3 rename Box, 3 m right", () => task3(page, viewport, name, box)],
      ["4 Top and Bottom sections", async () => { sectioned = await task4(page, viewport, box); }],
      ["5 open a Look from the yard", () => (sectioned ? task5(page, viewport, sectioned, original.looks[0]) : Promise.reject(new Error("no sections from 4")))],
      ["6 add a light, Space evenly keeps it", () => (sectioned ? task6(page, viewport, sectioned) : Promise.reject(new Error("no sections from 4")))],
      ["7 4 m line, 120 then 100", () => task7(page, viewport, line)],
      ["8 delete, undo, delete, reload", () => task8(page, viewport, line)],
    ]) {
      try {
        await step();
        console.log(`ok ${viewport.name} ${label}`);
      } catch (error) {
        failed += 1;
        console.error(`FAIL ${viewport.name} ${label}\n${error instanceof Error ? error.message : String(error)}`);
        await page.screenshot({ path: `/tmp/editor-fail-${viewport.name}-${label.split(" ")[0]}.png` }).catch(() => {});
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
  console.error(`${failed} yard task check(s) failed`);
  process.exit(1);
}
console.log("the eight yard tasks pass at 1440×900 and 390×844");
