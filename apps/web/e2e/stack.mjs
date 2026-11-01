/**
 * Shared by the browser checks: reuse a stack already on :43180, or start
 * fixture, sim, API, and web, and stop what was started.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

export const webOrigin = process.env.NIGHTPLOT_WEB_URL ?? "http://127.0.0.1:43180";
export const apiOrigin = process.env.NIGHTPLOT_API_URL ?? "http://127.0.0.1:43181";
const root = fileURLToPath(new URL("../../../", import.meta.url));

const children = [];

export async function up(url) {
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

export async function waitFor(url, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await up(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const logs = recentLogs();
  throw new Error(`timed out waiting for ${url}${logs ? `\n${logs}` : ""}`);
}

export function stopChildren() {
  for (const child of children) {
    if (child.pid) {
      try { process.kill(-child.pid, "SIGTERM"); } catch { /* already gone */ }
    }
  }
}

export async function launch() {
  const args = ["--no-sandbox", "--disable-dev-shm-usage"];
  try {
    return await chromium.launch({ channel: "chrome", args });
  } catch {
    return await chromium.launch({ args });
  }
}

/** Start the stack unless one is already answering. */
export async function ensureStack() {
  if (await up(webOrigin)) return;
  start(["pnpm", "fixture"]);
  start(["pnpm", "sim"]);
  start(["pnpm", "--filter", "@nightplot/server", "dev"], {
    NIGHTPLOT_DISCOVERY_TARGETS: "127.0.0.1:48210,127.0.0.1:48211",
  });
  start(["pnpm", "--filter", "@nightplot/web", "dev"]);
  await waitFor(`${webOrigin}/`, 90000);
  await waitFor(`${apiOrigin}/health`, 90000);
}
