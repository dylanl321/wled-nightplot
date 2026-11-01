/**
 * Phone viewports must not scroll sideways.
 * Reuses a stack already on :43180, or starts fixture, sim, API, and web.
 */
import { apiOrigin, ensureStack, launch, stopChildren, webOrigin } from "./stack.mjs";

const viewports = [
  { name: "iphone-390x844", width: 390, height: 844 },
  { name: "android-360x780", width: 360, height: 780 },
];

/** The path editor at a wide window and a short landscape phone, beside the phone checks. */
const editorViewports = [
  { name: "desktop-1440x900", width: 1440, height: 900, touch: false },
  { name: "desktop-1280x800", width: 1280, height: 800, touch: false },
  { name: "landscape-844x390", width: 844, height: 390, touch: true },
];

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

await ensureStack();

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

  // The path editor on a wide window and a short landscape phone: no
  // overflow, every tool a real target (not a hairline column), and the
  // drawing takes the pointer.
  for (const viewport of editorViewports) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, hasTouch: viewport.touch });
    const page = await context.newPage();
    try {
      await page.goto(`${webOrigin}/props/new`, { waitUntil: "domcontentloaded" });
      await settle(page);
      await page.getByRole("textbox").fill("Ridge");
      await page.getByRole("button", { name: "Next", exact: true }).click();
      await page.getByRole("button", { name: /Draw it/ }).click();
      await page.getByRole("button", { name: "Next", exact: true }).click();
      await page.getByRole("button", { name: "Name sections" }).waitFor();
      await page.locator("[data-testid=layout-canvas] canvas").first().waitFor();
      assertFits(`${viewport.name} editor`, await measure(page));
      const tools = await page.locator("aside[aria-label='Path tools'] button").evaluateAll((nodes) =>
        nodes.map((node) => {
          const box = node.getBoundingClientRect();
          return { name: node.textContent?.trim() ?? "", w: box.width, h: box.height, bottom: box.bottom, right: box.right };
        }),
      );
      const bad = tools.filter((tool) => tool.w < 44 || tool.h < 40 || tool.h > 72 || tool.bottom > viewport.height + 1 || tool.right > viewport.width + 1);
      if (tools.length < 6 || bad.length) throw new Error(`${viewport.name} editor tools\n${JSON.stringify(bad.length ? bad : tools)}`);
      const canvas = await page.getByTestId("layout-canvas").boundingBox();
      if (!canvas || canvas.width < 200 || canvas.height < 150) throw new Error(`${viewport.name} drawing too small ${JSON.stringify(canvas)}`);
      const hit = await page.evaluate(([x, y]) => Boolean(document.elementFromPoint(x, y)?.closest("[data-testid=layout-canvas]")), [canvas.x + canvas.width / 2, canvas.y + canvas.height / 2]);
      if (!hit) throw new Error(`${viewport.name} the drawing does not take the pointer`);
      console.log(`ok ${viewport.name} editor`);
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
  console.error(`${failed} viewport check(s) failed`);
  process.exit(1);
}
console.log("phone and editor viewports fit");
