/**
 * Shape-aware design on a Look, through the UI at 1440×900 with a mouse and
 * 390×844 with a finger: see the well's border and inside, make sections
 * from its shape, set one diagonal to travel toward the centre, use that on
 * the other diagonal, then use the whole design on a second well.
 * Nothing is sent to a Light. Screenshots land in NIGHTPLOT_SHOTS.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { apiOrigin, ensureStack, launch, stopChildren, webOrigin } from "./stack.mjs";

const shots = process.env.NIGHTPLOT_SHOTS ?? "/opt/cursor/artifacts/screenshots";
const viewports = [
  { name: "1440x900", width: 1440, height: 900, touch: false },
  { name: "390x844", width: 390, height: 844, touch: true },
];

async function api(path, init) {
  const res = await fetch(`${apiOrigin}${path}`, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} ${res.status} ${JSON.stringify(body)}`);
  return body;
}

/** A square with an X, one metre a side. */
function well() {
  const corners = [["c1", 0, 0], ["c2", 1, 0], ["c3", 1, 1], ["c4", 0, 1]].map(([id, x, y]) => ({ id, x, y }));
  const run = [["e1", "c1", "c2"], ["e2", "c2", "c3"], ["e3", "c3", "c4"], ["e4", "c4", "c1"], ["e5", "c1", "c3"], ["e6", "c2", "c4"]]
    .map(([id, from, to]) => ({ id, from, to, kind: "lit" }));
  return { source: "trace", units: "m", pitchM: 0.1, startOffsetM: 0, corners, run, strings: [{ id: "s1", startId: "c1", run }] };
}

async function freshWell(label, x) {
  for (const row of (await api("/api/props")).props.filter((item) => item.label === label)) {
    await api(`/api/props/${row.id}`, { method: "DELETE" });
  }
  const created = await api("/api/props", { method: "POST", body: JSON.stringify({ label, kind: "custom", unit: "m", pitchMm: 100, layout: well(), sections: [] }) });
  await api(`/api/props/${created.prop.id}/yard`, { method: "PATCH", body: JSON.stringify({ yard: { x, y: 0.5 } }) });
  return created.prop;
}

function step(name) { console.log(`  · ${name}`); }

async function tap(locator, touch) {
  if (touch) await locator.tap();
  else await locator.click();
}

async function walk(browser, vp) {
  const a = await freshWell("Shape well A", 8);
  const b = await freshWell("Shape well B", 9.5);
  const looks = await api("/api/looks");
  const lookId = looks.looks[0].id;
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch });
  const page = await context.newPage();
  try {
    step("1 see the well's shape");
    await page.goto(`${webOrigin}/looks/${lookId}?prop=${b.id}`);
    const shape = page.locator(".shape");
    await shape.getByText(/4 sides · 4 corners · a centre/).waitFor({ timeout: 20000 });
    if ((await shape.locator("svg.shapeview circle").count()) < 40) throw new Error("the shape drawing has too few lights");

    step("2 sections from the shape, on both wells");
    await tap(page.getByRole("button", { name: "Follow Look" }), vp.touch);
    await tap(shape.getByRole("button", { name: "Each side and part" }), vp.touch);
    await page.getByText("6 sections made from the shape.").waitFor({ timeout: 10000 });
    await page.goto(`${webOrigin}/looks/${lookId}?prop=${a.id}`);
    await page.locator(".shape").getByText(/4 sides/).waitFor({ timeout: 20000 });
    await tap(page.getByRole("button", { name: "Follow Look" }), vp.touch);
    await tap(page.locator(".shape").getByRole("button", { name: "Each side and part" }), vp.touch);
    await page.getByText("6 sections made from the shape.").waitFor({ timeout: 10000 });
    for (const name of ["Top", "Right", "Bottom", "Left", "Inside 1", "Inside 2"]) {
      await page.locator(".secchips").getByRole("button", { name: new RegExp(`^${name}`) }).first().waitFor();
    }

    step("3 one diagonal travels toward the centre");
    await tap(page.locator(".secchips").getByRole("button", { name: /^Inside 1/ }), vp.touch);
    await tap(page.getByRole("group", { name: "How it lights" }).getByRole("button", { name: "Own style" }), vp.touch);
    await tap(page.getByRole("group", { name: "Which way it travels" }).getByRole("button", { name: "Toward the centre" }), vp.touch);
    await page.screenshot({ path: join(shots, `shape-section-${vp.name}.png`), fullPage: false });

    step("4 use it on the other diagonal");
    const other = page.locator(".shape .check", { hasText: /^Inside 2/ });
    await other.locator("input").check();
    await tap(page.locator(".shape").getByRole("button", { name: "Use on 1" }), vp.touch);
    await page.getByText(/Design used on 1 section, each set to travel toward the centre/).waitFor({ timeout: 5000 });

    step("5 use the well's design on the second well");
    await tap(page.locator(".secchips").getByRole("button", { name: "Whole prop" }), vp.touch);
    const similar = page.locator(".shape .check", { hasText: "Shape well B" });
    await similar.locator("input").check();
    await tap(page.locator(".shape").getByRole("button", { name: "Use on 1" }), vp.touch);
    await page.getByText(/design used on Shape well B/).waitFor({ timeout: 5000 });
    await page.screenshot({ path: join(shots, `shape-prop-${vp.name}.png`), fullPage: false });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 1) throw new Error(`page scrolls sideways by ${overflow}px`);

    step("6 saved: every diagonal on both wells runs toward the centre");
    let rows = [];
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const doc = await api("/api/looks");
      const look = doc.looks.find((row) => row.id === lookId);
      const props = (await api("/api/props")).props;
      const inside = props.filter((row) => row.id === a.id || row.id === b.id)
        .flatMap((row) => row.sections.filter((section) => section.name.startsWith("Inside")).map((section) => ({ propId: row.id, sectionId: section.id })));
      rows = inside.map((want) => look.overrides.find((row) => row.propId === want.propId && row.sectionId === want.sectionId));
      if (rows.length === 4 && rows.every((row) => row?.style?.dir === "mirror" && row.style.motion === "inward")) return;
    }
    throw new Error(`diagonals not all toward the centre: ${JSON.stringify(rows)}`);
  } catch (error) {
    await page.screenshot({ path: join(shots, `shape-fail-${vp.name}.png`), fullPage: true }).catch(() => {});
    throw error;
  } finally {
    await context.close();
  }
}

async function cleanup() {
  const looks = await api("/api/looks");
  const props = (await api("/api/props")).props.filter((row) => row.label.startsWith("Shape well "));
  const ids = new Set(props.map((row) => row.id));
  await api("/api/looks", {
    method: "PUT",
    body: JSON.stringify({
      version: looks.version,
      looks: looks.looks.map((look) => ({ ...look, overrides: look.overrides.filter((row) => !ids.has(row.propId)), ...(look.propIds ? { propIds: look.propIds.filter((id) => !ids.has(id)) } : {}) })),
      playlists: looks.playlists,
      schedule: looks.schedule,
    }),
  });
  for (const row of props) await api(`/api/props/${row.id}`, { method: "DELETE" });
}

mkdirSync(shots, { recursive: true });
await ensureStack();
const browser = await launch();
let failed = false;
try {
  for (const vp of viewports) {
    console.log(vp.name);
    try {
      await walk(browser, vp);
      console.log(`  ✓ shape design at ${vp.name}`);
    } catch (error) {
      failed = true;
      console.error(`  ✗ ${vp.name}: ${error.message}`);
    }
  }
} finally {
  await cleanup().catch((error) => console.error(`cleanup: ${error.message}`));
  await browser.close();
  stopChildren();
}
process.exit(failed ? 1 : 0);
