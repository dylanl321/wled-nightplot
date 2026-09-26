import { createServer } from "node:http";

const port = Number.parseInt(process.env.NIGHTPLOT_FIXTURE_PORT ?? "48210", 10);
const hostname = "127.0.0.1";
const ledCount = 60;

const info = {
  ver: "0.15.4",
  name: process.env.NIGHTPLOT_FIXTURE_NAME ?? "WLED",
  mac: "020000000001",
  brand: "WLED",
  product: "FOSS",
  leds: { count: ledCount, rgbw: false },
};

type Seg = { start: number; stop: number; col: number[][] };

const state: { on: boolean; bri: number; seg: Seg[] } = {
  on: true,
  bri: 140,
  seg: [{ start: 0, stop: ledCount, col: [[255, 160, 0]] }],
};

const pixels = Array.from({ length: ledCount }, () => "#ffa000");
let mismatch = process.env.NIGHTPLOT_FIXTURE_MISMATCH === "1";

function rgbToHex(rgb: number[]): string {
  return `#${rgb
    .slice(0, 3)
    .map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0"))
    .join("")}`;
}

function paint(start: number, stop: number, rgb: number[]) {
  const hex = rgbToHex(rgb);
  for (let i = start; i < stop && i < pixels.length; i += 1) {
    pixels[i] = hex;
  }
}

function applyState(body: unknown) {
  if (!body || typeof body !== "object") return;
  const next = body as { on?: unknown; bri?: unknown; seg?: unknown };
  if (typeof next.on === "boolean") state.on = next.on;
  if (typeof next.bri === "number") state.bri = Math.max(0, Math.min(255, Math.round(next.bri)));
  if (!Array.isArray(next.seg)) return;
  const segs: Seg[] = [];
  for (const raw of next.seg) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as { start?: unknown; stop?: unknown; col?: unknown };
    const start = typeof row.start === "number" ? row.start : 0;
    const stop = typeof row.stop === "number" ? row.stop : ledCount;
    if (!Number.isFinite(start) || !Number.isFinite(stop) || stop <= start) continue;
    const col = Array.isArray(row.col) && Array.isArray(row.col[0]) ? row.col : [[[255, 160, 0]]];
    const rgb = (col[0] as number[]).map(Number);
    segs.push({ start, stop, col: [rgb] });
    paint(start, stop, rgb);
  }
  if (mismatch && segs.length > 0) {
    const last = segs[segs.length - 1]!;
    last.stop = Math.max(last.start + 1, last.stop - 10);
  }
  if (segs.length) state.seg = segs;
}

function liveLeds(): string[] {
  if (!state.on) return pixels.map(() => "#000000");
  return pixels.slice();
}

const server = createServer((req, res) => {
  const url = req.url ?? "/";
  res.setHeader("Content-Type", "application/json");

  if (url === "/json") {
    res.end(JSON.stringify({ info, state }));
    return;
  }
  if (url === "/json/info") {
    res.end(JSON.stringify(info));
    return;
  }
  if (url === "/json/live") {
    res.end(
      JSON.stringify({
        leds: liveLeds().map((hex) => hex.slice(1)),
        nightplot: "fixture",
      }),
    );
    return;
  }
  if (url === "/nightplot/mismatch") {
    if (req.method === "POST" || req.method === "PUT") {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk as Buffer));
      req.on("end", () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as {
            on?: unknown;
          };
          if (typeof body.on === "boolean") mismatch = body.on;
        } catch {
          /* keep */
        }
        res.end(JSON.stringify({ mismatch, nightplot: "fixture" }));
      });
      return;
    }
    res.end(JSON.stringify({ mismatch, nightplot: "fixture" }));
    return;
  }
  if (url === "/json/state") {
    if (req.method === "POST" || req.method === "PUT") {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk as Buffer));
      req.on("end", () => {
        try {
          applyState(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
        } catch {
          /* keep previous state */
        }
        res.end(JSON.stringify({ success: true, state }));
      });
      return;
    }
    res.end(JSON.stringify(state));
    return;
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ error: "not_found" }));
});

server.listen(port, hostname, () => {
  console.log(`wled fixture  http://${hostname}:${port}  (stub — not Hardware Done)`);
});
