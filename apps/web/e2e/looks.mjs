/**
 * The nine Looks tasks from docs/looks-plan.md, walked through the UI at
 * 1440×900 with a mouse and 390×844 with a finger, against the fixture and
 * the sim. Garage Light is a second sim (48212) this script starts and then
 * stops for task 7. Screenshots land in NIGHTPLOT_SHOTS.
 *
 * Writes presets to the fixture and sim only.
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { apiOrigin, ensureStack, launch, stopChildren, webOrigin } from "./stack.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const shots = process.env.NIGHTPLOT_SHOTS ?? "/opt/cursor/artifacts/screenshots";
const only = process.env.NIGHTPLOT_LOOKS_ONLY ?? "";
const viewports = [
  { name: "1440x900", width: 1440, height: 900, touch: false },
  { name: "390x844", width: 390, height: 844, touch: true },
].filter((row) => !only || row.name === only);

const GARAGE_PORT = 48212;

async function api(path, init) {
  const res = await fetch(`${apiOrigin}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} ${res.status} ${JSON.stringify(body)}`);
  return body;
}

function path(points, opts = {}) {
  const corners = points.map(([x, y], i) => ({ id: `c${i + 1}`, x, y }));
  const n = opts.closed ? points.length : points.length - 1;
  const run = Array.from({ length: n }, (_, i) => ({ id: `e${i + 1}`, from: `c${i + 1}`, to: `c${((i + 1) % points.length) + 1}`, kind: "lit" }));
  return { source: "template", units: "m", pitchM: 0.1, startOffsetM: 0, corners, run, strings: [{ id: "s1", startId: "c1", run }] };
}

let garage = null;
function startGarage() {
  garage = spawn("npx", ["tsx", "src/wled-sim.ts"], {
    cwd: join(here, "../../server"),
    env: { ...process.env, NIGHTPLOT_SIM_PORT: String(GARAGE_PORT), NIGHTPLOT_SIM_DDP_PORT: "4049", NIGHTPLOT_SIM_NAME: "Garage Light" },
    stdio: "ignore",
    detached: true,
  });
}
function killGarage() {
  // npx → tsx → node: end the whole group, not just npx.
  try { process.kill(-garage.pid, "SIGTERM"); } catch { garage.kill("SIGTERM"); }
  garage = null;
}
async function garageUp() {
  try { return (await fetch(`http://127.0.0.1:${GARAGE_PORT}/json/info`, { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; }
}
async function ensureGarage() {
  if (await garageUp()) return;
  startGarage();
  for (let i = 0; i < 60 && !(await garageUp()); i += 1) await new Promise((r) => setTimeout(r, 500));
  if (!(await garageUp())) throw new Error("Garage Light sim did not start");
}
async function unplugGarage() {
  if (garage) killGarage();
  else {
    // A sim this script did not start: find it by port.
    await new Promise((resolve) => spawn("bash", ["-c", `fuser -k ${GARAGE_PORT}/tcp || pkill -f 'NIGHTPLOT_SIM_PORT=${GARAGE_PORT}'`], { stdio: "ignore" }).on("exit", resolve));
  }
  for (let i = 0; i < 20 && (await garageUp()); i += 1) await new Promise((r) => setTimeout(r, 250));
}

async function enroll(host, name) {
  const listed = await api("/api/lights");
  let light = listed.lights.find((row) => row.port === Number(host.split(":")[1]));
  if (!light) light = (await api("/api/lights", { method: "POST", body: JSON.stringify({ host }) })).light;
  if (light.name !== name) {
    await api(`/api/lights/${light.id}`, { method: "PATCH", body: JSON.stringify({ name }) }).catch(() => undefined);
  }
  return (await api("/api/lights")).lights.find((row) => row.id === light.id);
}

async function prop(label, kind, layout, yard, sections) {
  const existing = (await api("/api/props")).props.find((row) => row.label === label);
  if (existing) return existing;
  const created = await api("/api/props", { method: "POST", body: JSON.stringify({ label, kind, unit: "m", pitchMm: 100, layout, ...(sections ? { sections } : {}) }) });
  await api(`/api/props/${created.prop.id}/yard`, { method: "PATCH", body: JSON.stringify({ yard }) });
  return created.prop;
}

async function attach(propRow, light, place) {
  const attachments = (await api("/api/props")).attachments ?? [];
  if (attachments.some((row) => row.propId === propRow.id)) return;
  await api(`/api/props/${propRow.id}/attach`, {
    method: "POST",
    body: JSON.stringify({ lightId: light.id, outputId: light.outputs[0].id, ...place, apply: false }),
  });
}

/** Props on three Lights, and a wreath on none, with the default Looks. */
async function neutral() {
  for (const port of [48210, 48211, GARAGE_PORT]) {
    await fetch(`http://127.0.0.1:${port}/json/state`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ on: true, bri: 128, seg: [{ id: 0, start: 0, stop: 60, fx: 0, sx: 128, ix: 128, col: [[255, 160, 0], [0, 0, 0], [0, 0, 0]] }] }),
    }).catch(() => undefined);
  }
}

async function seed() {
  await ensureGarage();
  await neutral();
  const porch = await enroll("127.0.0.1:48210", "Porch Light");
  const eave = await enroll("127.0.0.1:48211", "Eave Light");
  const garageLight = await enroll(`127.0.0.1:${GARAGE_PORT}`, "Garage Light");
  const roof = await prop("Roofline", "roofline", path([[0, 3], [2.5, 3], [5, 3]]), { x: 0, y: 3 }, [
    { id: "left", name: "Left", edgeIds: ["e1"], pinnedRanges: [] },
    { id: "right", name: "Right", edgeIds: ["e2"], pinnedRanges: [] },
  ]);
  const win1 = await prop("Left window", "window", path([[0, 0], [0.7, 0], [0.7, 0.5], [0, 0.5]], { closed: true }), { x: 0.5, y: 1.2 });
  const win2 = await prop("Right window", "window", path([[0, 0], [0.7, 0], [0.7, 0.5], [0, 0.5]], { closed: true }), { x: 3.5, y: 1.2 });
  const tree = await prop("Tree", "tree", path([[0, 0], [0.5, 1.5], [1, 0]]), { x: 6.5, y: 0 });
  const arch = await prop("Door arch", "arch", path([[0, 0], [0, 1], [0.6, 1.3], [1.2, 1], [1.2, 0]]), { x: 1.6, y: 0 });
  await attach(roof, eave, { startIndex: 0 });
  await attach(win1, porch, { startIndex: 0 });
  await attach(arch, garageLight, { startIndex: 0 });
  await attach(win2, garageLight, { afterPropId: arch.id });
  await attach(tree, porch, { afterPropId: win1.id });
  return { porch, eave, garageLight, ids: { roof: roof.id, win1: win1.id, win2: win2.id, tree: tree.id, arch: arch.id } };
}

async function addWreath() {
  return prop("Wreath", "custom", path([[0, 0], [0.3, 0.3], [0, 0.6], [-0.3, 0.3]], { closed: true }), { x: 2.1, y: 2.3 });
}

/** Back to the default Looks, no wreath, Garage Light plugged in. */
async function reset(baseline) {
  const props = (await api("/api/props")).props;
  const wreath = props.find((row) => row.label === "Wreath");
  if (wreath) await api(`/api/props/${wreath.id}`, { method: "DELETE" });
  const doc = await api("/api/looks");
  await api("/api/looks", { method: "PUT", body: JSON.stringify({ version: doc.version, looks: baseline.looks, playlists: baseline.playlists, schedule: baseline.schedule }) });
  await ensureGarage();
  await neutral();
}

async function fits(page, where) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 1) throw new Error(`${where}: page scrolls sideways by ${overflow}px`);
}

function step(name) { console.log(`  · ${name}`); }

async function shot(page, vp, name) {
  await page.screenshot({ path: join(shots, `looks-${vp.name}-${name}.png`) });
}

async function tap(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  await locator.click();
}

async function walk(browser, vp, ctx) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch });
  const page = await context.newPage();
  try { await tasks(page, vp, ctx); }
  catch (error) { await shot(page, vp, "fail").catch(() => undefined); throw error; }
  finally { await context.close(); }
}

async function tasks(page, vp, ctx) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => dialog.accept());
  const phone = vp.width < 640;
  const inspector = page.locator(".insp");
  const rail = page.locator(".rail");

  /** Select a prop: the rail on a desktop, the whole-Look list on a phone. */
  async function selectProp(label) {
    if (!phone) { await tap(page, rail.getByRole("button", { name: new RegExp(`^${label}`) })); return; }
    const back = inspector.getByRole("button", { name: "Back to the whole Look" });
    if (await back.count()) await tap(page, back);
    await tap(page, inspector.locator(".proprow > button", { hasText: label }));
  }
  async function wholeLook() {
    const back = inspector.getByRole("button", { name: "Back to the whole Look" });
    if (await back.count()) await tap(page, back);
  }
  async function setMode(label, mode) {
    await wholeLook();
    await tap(page, inspector.getByRole("group", { name: `${label} in this Look` }).getByRole("button", { name: mode, exact: true }));
  }
  async function pickEffect(name) {
    await tap(page, inspector.locator(".effrow").first());
    await inspector.getByLabel("Search effects").fill(name);
    await tap(page, inspector.locator(".effrow", { hasText: name }).first());
  }
  async function colour(label, hex) {
    const box = inspector.getByLabel(`${label} hex`);
    await box.scrollIntoViewIfNeeded();
    await box.fill(hex);
    await box.press("Enter");
  }
  async function saved() {
    // textContent, not innerText: the phone hides the save note.
    await page.waitForTimeout(500);
    await page.waitForFunction(() => !document.body.textContent.includes("Saving…"), null, { timeout: 10000 });
  }

  // 1. New Look "Christmas Eve".
  step("1 new Look");
  await page.goto(`${webOrigin}/looks`, { waitUntil: "networkidle" });
  await fits(page, "Looks page");
  await shot(page, vp, "0-page");
  await tap(page, page.getByRole("button", { name: /New Look/ }));
  await page.getByRole("dialog", { name: "New Look" }).getByRole("button", { name: "Make it" }).click();
  await page.waitForURL(/\/looks\/look-/);
  const name = inspector.getByLabel("Name");
  await name.fill("Christmas Eve");
  for (const label of ["Door arch"]) await setMode(label, "Off");
  await selectProp("Roofline");
  await tap(page, inspector.getByRole("group", { name: "How it lights" }).getByRole("button", { name: "Own style" }));
  await pickEffect("Theater");
  const labels = await inspector.locator("input[aria-label$=' hex']").evaluateAll((rows) => rows.map((row) => row.getAttribute("aria-label")));
  await colour(labels[0].replace(/ hex$/, ""), "#ff0000");
  await colour(labels[1].replace(/ hex$/, ""), "#ffffff");
  await selectProp("Tree");
  await tap(page, inspector.getByRole("group", { name: "How it lights" }).getByRole("button", { name: "Own style" }));
  await pickEffect("Twinkle");
  const treeColour = (await inspector.locator("input[aria-label$=' hex']").first().getAttribute("aria-label")).replace(/ hex$/, "");
  await colour(treeColour, "#00a020");
  await saved();
  await fits(page, "Look editor");
  await shot(page, vp, "1-christmas-eve");
  let doc = await api("/api/looks");
  const eve = doc.looks.find((row) => row.name === "Christmas Eve");
  if (!eve) throw new Error("Christmas Eve was not saved");
  const roofStyle = eve.overrides.find((row) => row.propId === ctx.ids.roof && !row.sectionId)?.style;
  if (!roofStyle || roofStyle.color !== "#ff0000" || roofStyle.color2 !== "#ffffff") throw new Error(`Roofline style ${JSON.stringify(roofStyle)}`);
  if ((eve.propIds ?? []).includes(ctx.ids.arch)) throw new Error("Door arch is still on");

  // 2. Preview on lights, slow the chase.
  step("2 preview, slow the chase");
  const before = await fetch(`http://127.0.0.1:48211/json/state`).then((res) => res.json());
  await tap(page, page.getByRole("button", { name: /Preview on lights/ }));
  await page.locator(".chip.preview").waitFor({ timeout: 15000 });
  await page.waitForFunction(() => /Previewing on \d+ of \d+/.test(document.querySelector(".chip")?.textContent ?? ""), null, { timeout: 15000 });
  await selectProp("Roofline");
  const speed = inspector.getByRole("slider", { name: /Speed/ });
  await speed.scrollIntoViewIfNeeded();
  await speed.fill("40");
  await page.waitForTimeout(900);
  const eaveState = await fetch(`http://127.0.0.1:48211/json/state`).then((res) => res.json());
  if (!eaveState.seg.some((seg) => seg.sx === 40)) throw new Error(`Preview did not slow the roofline: ${JSON.stringify(eaveState.seg.map((seg) => seg.sx))}`);
  await shot(page, vp, "2-preview");

  // 3. Right half gold.
  step("3 right half gold");
  await tap(page, inspector.getByRole("button", { name: /^Right/ }));
  await tap(page, inspector.getByRole("group", { name: "How it lights" }).getByRole("button", { name: "Own style" }));
  const secColour = (await inspector.locator("input[aria-label$=' hex']").first().getAttribute("aria-label")).replace(/ hex$/, "");
  await colour(secColour, "#ffc000");
  await saved();
  await shot(page, vp, "3-right-gold");
  await tap(page, page.getByRole("button", { name: "Done" }));
  await page.waitForURL(/\/looks(\?|$)/);
  doc = await api("/api/looks");
  const right = doc.looks.find((row) => row.name === "Christmas Eve").overrides.find((row) => row.propId === ctx.ids.roof && row.sectionId === "right");
  if (right?.style?.color !== "#ffc000") throw new Error(`Right section ${JSON.stringify(right)}`);
  const ended = await fetch(`http://127.0.0.1:48211/json/state`).then((res) => res.json());
  const shape = (state) => JSON.stringify(state.seg.map((seg) => [seg.start, seg.stop, seg.fx, seg.sx, seg.col]));
  if (shape(ended) !== shape(before)) throw new Error(`Done did not put the Light back: ${shape(ended)} vs ${shape(before)}`);

  // 4. Wreath in two Looks.
  step("4 wreath in two Looks");
  await addWreath();
  // From the yard, as the prototype does it.
  await page.goto(`${webOrigin}/`, { waitUntil: "networkidle" });
  const wreathCard = page.locator("li", { hasText: "Wreath" }).filter({ hasText: "In no Look" });
  await tap(page, wreathCard.getByRole("link", { name: "Add to Looks…" }));
  await page.waitForURL(/\/looks/);
  const add = page.getByRole("dialog", { name: "Add to Looks" });
  await add.getByLabel("Christmas Eve").check();
  const warm = doc.looks.find((row) => /warm/i.test(row.name));
  await add.getByLabel(warm.name).check();
  await add.getByRole("button", { name: "Add" }).click();
  await saved();
  await page.waitForTimeout(600);
  doc = await api("/api/looks");
  const wreathId = (await api("/api/props")).props.find((row) => row.label === "Wreath").id;
  const inLooks = doc.looks.filter((row) => !row.propIds || row.propIds.includes(wreathId)).map((row) => row.name).sort();
  if (JSON.stringify(inLooks) !== JSON.stringify(["Christmas Eve", warm.name].sort())) throw new Error(`Wreath is in ${inLooks}`);
  await shot(page, vp, "4-wreath");

  // 5. Playlist.
  step("5 playlist");
  await tap(page, page.getByRole("tab", { name: "Playlists" }));
  await tap(page, page.getByRole("button", { name: "+ New playlist" }));
  const card = page.locator(".item.open");
  const plName = card.getByLabel("Name");
  await plName.fill("Christmas");
  await card.getByLabel("Look 1", { exact: true }).selectOption({ label: "Christmas Eve" });
  await card.getByLabel("Minutes for Look 1").fill("10");
  await card.getByLabel("Minutes for Look 1").blur();
  await tap(page, card.getByRole("button", { name: /Add a Look/ }));
  const snowfall = doc.looks.find((row) => /snow/i.test(row.name));
  await card.getByLabel("Look 2", { exact: true }).selectOption({ label: snowfall.name });
  await card.getByLabel("Minutes for Look 2").fill("5");
  await card.getByLabel("Minutes for Look 2").blur();
  await saved();
  await page.waitForTimeout(600);
  doc = await api("/api/looks");
  const christmas = doc.playlists.find((row) => row.name === "Christmas");
  if (!christmas) throw new Error(`No Christmas playlist: ${doc.playlists.map((row) => row.name)}`);
  if (JSON.stringify(christmas.durationsTenths) !== JSON.stringify([6000, 3000])) throw new Error(`Durations ${christmas.durationsTenths}`);
  if (christmas.lookIds[0] !== eve.id || christmas.lookIds[1] !== snowfall.id) throw new Error("Playlist order");
  await fits(page, "Playlists");
  await shot(page, vp, "5-playlist");

  // 6. Schedule.
  step("6 schedule");
  await tap(page, page.getByRole("tab", { name: "Schedule" }));
  const nightly = doc.playlists.find((row) => /nightly/i.test(row.name));
  async function runs(row, name) {
    const select = row.getByLabel("Runs");
    await select.selectOption({ label: name });
  }
  if (!(await page.locator(".item .itemhead").filter({ has: page.getByRole("button", { name: "Edit" }) }).count())) {
    // No Schedule yet: Nightly all year first.
    await tap(page, page.getByRole("button", { name: "+ Add to the schedule" }));
    await runs(page.locator(".item.open"), `${nightly.name} playlist`);
  }
  if (await page.getByText("Sunset needs where the lights are").count()) {
    const fold = page.locator("details", { hasText: "Where the lights are" });
    if (!(await fold.evaluate((el) => el.open))) await tap(page, fold.locator("summary"));
    await page.getByLabel("Latitude").fill("39.96");
    await page.getByLabel("Latitude").blur();
    await page.getByLabel("Longitude").fill("-83.00");
    await page.getByLabel("Longitude").blur();
  }
  await tap(page, page.getByRole("button", { name: "+ Add to the schedule" }));
  const newRow = page.locator(".item.open");
  await runs(newRow, "Christmas playlist");
  await saved();
  await page.waitForTimeout(600);
  doc = await api("/api/looks");
  const sched = doc.schedule;
  const top = sched?.rows?.[0];
  if (!top || top.run.kind !== "playlist" || top.run.playlistId !== christmas.id) throw new Error(`Schedule row ${JSON.stringify(top)}`);
  if (top.dates?.from?.month !== 11 || top.dates?.from?.day !== 25 || top.dates?.to?.month !== 1 || top.dates?.to?.day !== 6) throw new Error(`Dates ${JSON.stringify(top.dates)}`);
  if (top.off?.kind !== "time" || top.off.hour !== 23) throw new Error(`Off ${JSON.stringify(top.off)}`);
  await page.getByText(/WLED timers|timers/).first().waitFor();
  await fits(page, "Schedule");
  await shot(page, vp, "6-schedule");

  // 7. Send with Garage Light unplugged.
  step("7 send, Garage Light unplugged");
  await unplugGarage();
  await tap(page, page.locator(".sendpill"));
  const send = page.getByRole("dialog", { name: "Send to lights" });
  const garageBox = send.getByLabel(/Garage Light/);
  if (!(await garageBox.isChecked())) await garageBox.check();
  await send.getByRole("button", { name: "Send", exact: true }).click();
  const results = page.getByRole("dialog", { name: "Send results" });
  await results.waitFor({ timeout: 120000 });
  await shot(page, vp, "7-send");
  const text = await results.innerText();
  if (!/Garage Light[\s\S]*Not sent/.test(text)) throw new Error(`Garage Light row: ${text}`);
  if ((text.match(/Up to date/g) ?? []).length < 2) throw new Error(`Others not up to date: ${text}`);
  await results.getByRole("button", { name: "Close" }).click();
  const pill = await page.locator(".sendpill").innerText();
  if (!/not sent/.test(pill)) throw new Error(`Pill after send: ${pill}`);
  await shot(page, vp, "7-pill");

  // 8. Party: Warm white now.
  step("8 warm white now");
  await tap(page, page.getByRole("tab", { name: "Looks" }));
  const warmCard = page.locator(".card").filter({ has: page.getByRole("button", { name: `Edit ${warm.name}` }) });
  await tap(page, warmCard.getByRole("button", { name: /Turn on now|Send and turn on/ }));
  const toast = page.locator(".toast", { hasText: "Schedule takes over" });
  await toast.waitFor({ timeout: 60000 }).catch(() => undefined);
  const said = await page.locator(".toast").allInnerTexts().then((rows) => rows.join(" | "));
  if (!/Schedule takes over/.test(said)) throw new Error(`Turn on toast: ${said}`);
  const porchState = await fetch(`http://127.0.0.1:48210/json/state`).then((res) => res.json());
  if (porchState.ps !== warm.slot) throw new Error(`Porch runs ${porchState.ps}, not ${warm.slot}`);
  await shot(page, vp, "8-turn-on");

  // 9. Door arch across Looks.
  step("9 door arch by prop");
  await tap(page, page.getByRole("tab", { name: "By prop" }));
  const archCells = page.getByRole("button", { name: /^Door arch in / });
  if ((await archCells.count()) !== doc.looks.length) throw new Error(`Door arch cells ${await archCells.count()} for ${doc.looks.length} Looks`);
  const offCell = page.getByRole("button", { name: "Door arch in Christmas Eve" });
  if (!(await offCell.getAttribute("class")).includes("off")) throw new Error("Door arch should read off in Christmas Eve");
  await fits(page, "By prop");
  await shot(page, vp, "9-by-prop");

  if (errors.length) throw new Error(`page errors: ${errors.join(" | ")}`);
}

await ensureStack();
mkdirSync(shots, { recursive: true });
const ctx = await seed();
const baseline = await api("/api/looks");
const browser = await launch();
let failed = false;
try {
  for (const vp of viewports) {
    console.log(vp.name);
    try {
      await walk(browser, vp, ctx);
      console.log(`  ✓ all nine at ${vp.name}`);
    } catch (error) {
      failed = true;
      console.error(`  ✗ ${vp.name}: ${error.message}`);
    } finally {
      await reset(baseline);
    }
  }
} finally {
  await browser.close();
  if (garage) killGarage();
  stopChildren();
}
process.exit(failed ? 1 : 0);
