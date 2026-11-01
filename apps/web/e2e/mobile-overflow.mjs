/**
 * Phone viewports must not scroll sideways.
 * Reuses a stack already on :43180, or starts fixture, sim, API, and web.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const webOrigin = process.env.NIGHTPLOT_WEB_URL ?? "http://127.0.0.1:43180";
const apiOrigin = process.env.NIGHTPLOT_API_URL ?? "http://127.0.0.1:43181";
const root = fileURLToPath(new URL("../../../", import.meta.url));

const viewports = [
  { name: "iphone-390x844", width: 390, height: 844 },
  { name: "android-360x780", width: 360, height: 780 },
];

const children = [];

async function up(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return res.status < 500;
  } catch {
    return false;
  }
}

const childLogs = new Map();

function start(args, env = {}) {
  const child = spawn("corepack", args, {
    cwd: root,
    env: { ...process.env, ...env },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const chunks = [];
  const keep = (stream) => {
    stream.on("data", (chunk) => {
      chunks.push(chunk);
      let size = chunks.reduce((sum, item) => sum + item.length, 0);
      while (size > 24_000 && chunks.length > 1) size -= chunks.shift().length;
    });
  };
  keep(child.stdout);
  keep(child.stderr);
  childLogs.set(child, chunks);
  children.push(child);
  return child;
}

function recentLogs() {
  const parts = [];
  for (const chunks of childLogs.values()) {
    const text = Buffer.concat(chunks).toString("utf8").trim();
    if (text) parts.push(text.split("\n").slice(-30).join("\n"));
  }
  return parts.join("\n---\n");
}

async function waitFor(url, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await up(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const logs = recentLogs();
  throw new Error(`timed out waiting for ${url}${logs ? `\n${logs}` : ""}`);
}

function stopChildren() {
  for (const child of children) {
    if (child.pid) {
      try { process.kill(-child.pid, "SIGTERM"); } catch { /* already gone */ }
    }
  }
}

async function launch() {
  const args = ["--no-sandbox", "--disable-dev-shm-usage"];
  try {
    return await chromium.launch({ channel: "chrome", args });
  } catch {
    return await chromium.launch({ args });
  }
}

async function lightId() {
  const listed = await fetch(`${apiOrigin}/api/lights`).then((res) => res.json());
  let id = listed.lights?.[0]?.id;
  if (!id) {
    const enrolled = await fetch(`${apiOrigin}/api/lights`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ host: "127.0.0.1:48210" }),
    });
    if (!enrolled.ok && enrolled.status !== 409) {
      throw new Error(`enroll failed ${enrolled.status}`);
    }
    const again = await fetch(`${apiOrigin}/api/lights`).then((res) => res.json());
    id = again.lights?.[0]?.id;
  }
  if (!id) throw new Error("no Light to open");
  const detail = await fetch(`${apiOrigin}/api/lights/${id}`).then((res) => res.json());
  if ((detail.elements ?? []).length === 0) {
    await fetch(`${apiOrigin}/api/lights/${id}/elements`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        elements: [
          { label: "Porch", start: 0, stop: 24 },
          { label: "Eave", start: 30, stop: 60 },
        ],
      }),
    });
  }
  return id;
}

async function measure(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const vw = doc.clientWidth;
    const bleeds = [];
    const scrolls = [];
    for (const el of document.querySelectorAll("body *")) {
      if (el.closest("nextjs-portal")) continue;
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;
      if ((rect.right > vw + 1 || rect.left < -1) && !clippedToViewport(el, vw)) {
        bleeds.push(`${el.tagName.toLowerCase()} ${String(el.className).slice(0, 80)} right=${Math.round(rect.right)} left=${Math.round(rect.left)}`);
        if (bleeds.length >= 8) break;
      }
      if ((style.overflowX === "auto" || style.overflowX === "scroll") && el.scrollWidth > el.clientWidth + 2) {
        scrolls.push(`${el.tagName.toLowerCase()} ${String(el.className).slice(0, 80)} ${el.scrollWidth}>${el.clientWidth}`);
        if (scrolls.length >= 8) break;
      }
    }
    function clippedToViewport(el, width) {
      let node = el.parentElement;
      while (node && node !== document.body) {
        const style = getComputedStyle(node);
        if (style.overflowX === "hidden" || style.overflowX === "clip") {
          const box = node.getBoundingClientRect();
          if (box.width > 0 && box.left >= -1 && box.right <= width + 1) return true;
        }
        node = node.parentElement;
      }
      return false;
    }

    return {
      overflow: doc.scrollWidth - vw,
      bleeds,
      scrolls,
    };
  });
}

function assertFits(label, metrics) {
  const problems = [];
  if (metrics.overflow > 1) problems.push(`document overflow ${metrics.overflow}px`);
  if (metrics.bleeds.length) problems.push(`bleeds:\n${metrics.bleeds.join("\n")}`);
  if (metrics.scrolls.length) problems.push(`horizontal scroll:\n${metrics.scrolls.join("\n")}`);
  if (problems.length) throw new Error(`${label}\n${problems.join("\n")}`);
}

async function settle(page) {
  await page.waitForLoadState("domcontentloaded");
  const heading = page.locator("h1").first();
  if (await heading.count()) await heading.waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(400);
}

const reuse = await up(webOrigin);
if (!reuse) {
  start(["pnpm", "fixture"]);
  start(["pnpm", "sim"]);
  start(["pnpm", "--filter", "@nightplot/server", "dev"], {
    NIGHTPLOT_DISCOVERY_TARGETS: "127.0.0.1:48210,127.0.0.1:48211",
  });
  start(["pnpm", "--filter", "@nightplot/web", "dev"]);
  await waitFor(`${webOrigin}/`, 90000);
  await waitFor(`${apiOrigin}/health`, 90000);
}

const browser = await launch();
let failed = 0;
try {
  const id = await lightId();
  const routes = [
    ["yard", "/"],
    ["lights", "/lights"],
    ["discover", "/discover"],
    ["led-products", "/led-products"],
    ["backups", "/backups"],
    ["looks", "/looks"],
    ["yard", "/yard"],
    ["sync", "/sync"],
    ["settings", "/settings"],
    ["segments", `/lights/${id}`],
    ["strip", `/lights/${id}?tab=settings`],
    ["activity", `/lights/${id}?tab=activity`],
  ];

  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      hasTouch: true,
      isMobile: true,
    });
    const page = await context.newPage();
    for (const [name, path] of routes) {
      const label = `${viewport.name} ${name}`;
      try {
        await page.goto(`${webOrigin}${path}`, { waitUntil: "domcontentloaded" });
        await settle(page);
        assertFits(label, await measure(page));
        console.log(`ok ${label}`);
      } catch (error) {
        failed += 1;
        console.error(String(error));
      }
    }

    try {
      await page.goto(`${webOrigin}/lights/${id}?tab=settings`, { waitUntil: "domcontentloaded" });
      await settle(page);
      await page.getByRole("button", { name: /^Find length/ }).first().click();
      await page.getByRole("dialog").waitFor({ state: "visible" });
      assertFits(`${viewport.name} find-length`, await measure(page));
      console.log(`ok ${viewport.name} find-length`);
    } catch (error) {
      failed += 1;
      console.error(String(error));
    }

    try {
      await page.goto(`${webOrigin}/lights/${id}`, { waitUntil: "domcontentloaded" });
      await settle(page);
      await page.getByRole("button", { name: "Advanced editor" }).click();
      const add = page.getByRole("button", { name: "Add prop" });
      await add.evaluate((el) => el.scrollIntoView({ block: "center", inline: "nearest" }));
      await add.click();
      await page.getByRole("dialog").waitFor({ state: "visible" });
      assertFits(`${viewport.name} add-prop`, await measure(page));
      console.log(`ok ${viewport.name} add-prop`);
      await page.getByRole("button", { name: /Wireframe/ }).click();
      assertFits(`${viewport.name} add-prop-wireframe`, await measure(page));
      console.log(`ok ${viewport.name} add-prop-wireframe`);
      await page.getByRole("button", { name: "Open the net" }).click();
      await page.getByRole("dialog", { name: /Wireframe on/ }).waitFor({ state: "visible" });
      assertFits(`${viewport.name} wireframe-draw`, await measure(page));
      console.log(`ok ${viewport.name} wireframe-draw`);
      await page.getByRole("button", { name: "Lock corners on the strip" }).click();
      assertFits(`${viewport.name} wireframe-lock`, await measure(page));
      console.log(`ok ${viewport.name} wireframe-lock`);
      await page.getByRole("button", { name: "Review this wireframe" }).click();
      assertFits(`${viewport.name} wireframe-review`, await measure(page));
      console.log(`ok ${viewport.name} wireframe-review`);
    } catch (error) {
      failed += 1;
      console.error(String(error));
    }

    try {
      await page.goto(`${webOrigin}/props/new`, { waitUntil: "domcontentloaded" });
      await settle(page);
      assertFits(`${viewport.name} new-prop-name`, await measure(page));
      await page.getByRole("textbox").fill("Front roof");
      await page.getByRole("button", { name: "Next", exact: true }).click();
      assertFits(`${viewport.name} new-prop-shape`, await measure(page));
      await page.getByRole("button", { name: /Roofline/ }).click();
      await page.getByRole("button", { name: "Next", exact: true }).click();
      assertFits(`${viewport.name} new-prop-size`, await measure(page));
      await page.getByRole("button", { name: "Next", exact: true }).click();
      await page.getByRole("heading", { name: /controller end/ }).waitFor();
      assertFits(`${viewport.name} new-prop-origin`, await measure(page));
      await page.getByRole("button", { name: "Next", exact: true }).click();
      await page.getByRole("button", { name: "Name sections" }).waitFor();
      assertFits(`${viewport.name} new-prop-editor`, await measure(page));
      await page.getByRole("button", { name: "Name sections" }).click();
      await page.getByRole("heading", { name: "Name the sections" }).waitFor();
      assertFits(`${viewport.name} new-prop-sections`, await measure(page));
      console.log(`ok ${viewport.name} new-prop`);
      await page.goto(`${webOrigin}/props/new`, { waitUntil: "domcontentloaded" });
      await settle(page);
      await page.getByRole("textbox").fill("Well house");
      await page.getByRole("button", { name: "Next", exact: true }).click();
      await page.getByRole("button", { name: /Well house/ }).click();
      await page.getByRole("button", { name: "Next", exact: true }).click();
      await page.getByRole("button", { name: "Next", exact: true }).click();
      await page.getByRole("button", { name: "Name sections" }).waitFor();
      assertFits(`${viewport.name} well-house-path`, await measure(page));
      await page.getByRole("button", { name: "Name sections" }).click();
      await page.getByRole("heading", { name: "Name the sections" }).waitFor();
      assertFits(`${viewport.name} well-house-sections`, await measure(page));
      console.log(`ok ${viewport.name} well-house-sections`);
      await page.goto(`${webOrigin}/props/new`, { waitUntil: "domcontentloaded" });
      await settle(page);
      await page.getByRole("textbox").fill("Ridge");
      await page.getByRole("button", { name: "Next", exact: true }).click();
      await page.getByRole("button", { name: /Draw it/ }).click();
      await page.getByRole("button", { name: "Next", exact: true }).click();
      await page.getByRole("button", { name: "Name sections" }).waitFor();
      assertFits(`${viewport.name} new-prop-custom`, await measure(page));
      console.log(`ok ${viewport.name} new-prop-custom`);
    } catch (error) {
      failed += 1;
      console.error(String(error));
    }

    await context.close();
  }
} finally {
  await browser.close();
  stopChildren();
}

if (failed > 0) {
  console.error(`${failed} phone viewport check(s) failed`);
  process.exit(1);
}
console.log("phone viewports fit");
