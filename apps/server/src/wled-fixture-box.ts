import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { WLED_SK6812_RGBW_NATIVE_TYPE, WLED_WS281X_NATIVE_TYPE } from "@nightplot/shared";

export type FixtureBoxOptions = {
  name?: string;
  ver?: string;
  ledCount?: number;
  gpio?: number;
  /** WLED `hw.led.ins[0].type`. Default `TYPE_WS2812_RGB` (22). */
  nativeType?: number;
  /** WLED `hw.led.ins[0].order`. Default `COL_ORDER_GRB` (0). */
  nativeOrder?: number;
  cfgEnabled?: boolean;
  mismatch?: boolean;
  busMismatch?: boolean;
  infoCountLag?: boolean;
  infoNameLag?: boolean;
};

type Seg = { start: number; stop: number; col: number[][] };
type BusIns = {
  start: number;
  len: number;
  pin: number[];
  type: number;
  order: number;
  rev: boolean;
  skip: number;
};

/**
 * In-memory WLED-shaped box. `infoNameLag` keeps `/json/info` on the old
 * display name after a `/json/cfg` write — the metal behaviour tests used to miss.
 * `busMismatch` accepts a bus write but leaves `hw.led.ins` / `leds.count` stale.
 */
export function createFixtureBox(options: FixtureBoxOptions = {}) {
  let ledCount = options.ledCount ?? 60;
  const gpio = options.gpio ?? 16;
  const nativeType = options.nativeType ?? WLED_WS281X_NATIVE_TYPE;
  const nativeOrder = options.nativeOrder ?? 0;
  const info = {
    ver: options.ver ?? "0.15.4",
    name: options.name ?? "WLED",
    mac: "020000000001",
    brand: "WLED",
    product: "FOSS",
    leds: { count: ledCount, rgbw: nativeType === WLED_SK6812_RGBW_NATIVE_TYPE },
  };
  const cfgEnabled = options.cfgEnabled ?? true;
  const cfg: {
    id: { name: string };
    def: { on: boolean; bri: number; ps: number };
    light: { tr: { dur: number } };
    hw: { led: { maxpwr: number; total: number; ins: BusIns[] } };
  } = {
    id: { name: info.name },
    def: { on: true, bri: 128, ps: 0 },
    light: { tr: { dur: 7 } },
    hw: {
      led: {
        maxpwr: 850,
        total: ledCount,
        ins: [
          {
            start: 0,
            len: ledCount,
            pin: [gpio],
            type: nativeType,
            order: nativeOrder,
            rev: false,
            skip: 0,
          },
        ],
      },
    },
  };
  const state: { on: boolean; bri: number; seg: Seg[] } = {
    on: true,
    bri: 140,
    seg: [{ start: 0, stop: ledCount, col: [[255, 160, 0]] }],
  };
  const pixels = Array.from({ length: ledCount }, () => "#ffa000");
  let mismatch = options.mismatch ?? false;
  let busMismatch = options.busMismatch ?? false;
  let infoCountLag = options.infoCountLag ?? false;
  let infoNameLag = options.infoNameLag ?? false;

  function resizeStrip(nextCount: number) {
    const count = Math.max(1, Math.min(2048, Math.round(nextCount)));
    ledCount = count;
    info.leds.count = count;
    cfg.hw.led.total = count;
    cfg.hw.led.ins[0]!.len = count;
    const col = state.seg[0]?.col ?? [[255, 160, 0]];
    state.seg = [{ start: 0, stop: count, col }];
    while (pixels.length < count) pixels.push("#000000");
    pixels.length = count;
  }

  function applyCfg(body: unknown) {
    if (!body || typeof body !== "object") return;
    const next = body as {
      id?: { name?: unknown };
      def?: { on?: unknown; bri?: unknown; ps?: unknown };
      light?: { tr?: { dur?: unknown } };
      hw?: { led?: { maxpwr?: unknown; ins?: unknown } };
    };
    if (typeof next.id?.name === "string" && next.id.name.trim()) {
      const name = next.id.name.trim().slice(0, 32);
      cfg.id.name = name;
      if (!infoNameLag) info.name = name;
    }
    if (next.def && typeof next.def === "object") {
      if (typeof next.def.on === "boolean") cfg.def.on = next.def.on;
      if (typeof next.def.bri === "number") {
        cfg.def.bri = Math.max(1, Math.min(255, Math.round(next.def.bri)));
      }
      if (typeof next.def.ps === "number") {
        cfg.def.ps = Math.max(0, Math.min(250, Math.round(next.def.ps)));
      }
    }
    if (typeof next.light?.tr?.dur === "number") {
      cfg.light.tr.dur = Math.max(0, Math.min(655, Math.round(next.light.tr.dur)));
    }
    if (typeof next.hw?.led?.maxpwr === "number") {
      cfg.hw.led.maxpwr = Math.max(0, Math.min(65000, Math.round(next.hw.led.maxpwr)));
    }
    if (Array.isArray(next.hw?.led?.ins) && next.hw.led.ins[0] && !busMismatch) {
      const row = next.hw.led.ins[0] as Record<string, unknown>;
      const bus = cfg.hw.led.ins[0]!;
      if (typeof row.start === "number") bus.start = Math.max(0, Math.round(row.start));
      if (typeof row.type === "number") {
        bus.type = Math.round(row.type);
        info.leds.rgbw = bus.type === WLED_SK6812_RGBW_NATIVE_TYPE;
      }
      if (typeof row.order === "number") bus.order = Math.round(row.order);
      if (typeof row.rev === "boolean") bus.rev = row.rev;
      if (typeof row.skip === "number") bus.skip = Math.round(row.skip);
      if (Array.isArray(row.pin) && typeof row.pin[0] === "number") {
        bus.pin = [Math.round(row.pin[0])];
      }
      if (typeof row.len === "number") {
        if (infoCountLag) {
          const count = Math.max(1, Math.min(2048, Math.round(row.len)));
          bus.len = count;
          cfg.hw.led.total = count;
        } else {
          resizeStrip(row.len);
        }
      }
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
      paint(pixels, start, stop, rgb);
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

  function setInfoNameLag(on: boolean) {
    infoNameLag = on;
    if (!infoNameLag) info.name = cfg.id.name;
  }

  function handle(req: IncomingMessage, res: ServerResponse) {
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
        readJson(req, (body) => {
          if (typeof body.on === "boolean") mismatch = body.on;
          res.end(JSON.stringify({ mismatch, nightplot: "fixture" }));
        });
        return;
      }
      res.end(JSON.stringify({ mismatch, nightplot: "fixture" }));
      return;
    }
    if (url === "/nightplot/info-name-lag") {
      if (req.method === "POST" || req.method === "PUT") {
        readJson(req, (body) => {
          if (typeof body.on === "boolean") setInfoNameLag(body.on);
          res.end(
            JSON.stringify({
              infoNameLag,
              infoName: info.name,
              cfgName: cfg.id.name,
              nightplot: "fixture",
            }),
          );
        });
        return;
      }
      res.end(
        JSON.stringify({
          infoNameLag,
          infoName: info.name,
          cfgName: cfg.id.name,
          nightplot: "fixture",
        }),
      );
      return;
    }
    if (url === "/json/cfg") {
      if (!cfgEnabled) {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: "not_found" }));
        return;
      }
      if (req.method === "POST" || req.method === "PUT") {
        readJson(req, (body) => {
          applyCfg(body);
          res.end(JSON.stringify({ success: true, nightplot: "fixture" }));
        });
        return;
      }
      res.end(JSON.stringify(cfg));
      return;
    }
    if (url === "/json/state") {
      if (req.method === "POST" || req.method === "PUT") {
        readJson(req, (body) => {
          applyState(body);
          res.end(JSON.stringify({ success: true, state }));
        });
        return;
      }
      res.end(JSON.stringify(state));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not_found" }));
  }

  return {
    info,
    cfg,
    get infoNameLag() {
      return infoNameLag;
    },
    get busMismatch() {
      return busMismatch;
    },
    get ledCount() {
      return ledCount;
    },
    applyCfg,
    setInfoNameLag,
    setBusMismatch(on: boolean) {
      busMismatch = on;
    },
    handle,
    listen(port = 0, hostname = "127.0.0.1"): Server {
      return createServer(handle).listen(port, hostname);
    },
  };
}

function paint(pixels: string[], start: number, stop: number, rgb: number[]) {
  const hex = `#${rgb
    .slice(0, 3)
    .map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0"))
    .join("")}`;
  for (let i = start; i < stop && i < pixels.length; i += 1) {
    pixels[i] = hex;
  }
}

function readJson(req: IncomingMessage, done: (body: Record<string, unknown>) => void) {
  const chunks: Buffer[] = [];
  req.on("data", (chunk) => chunks.push(chunk as Buffer));
  req.on("end", () => {
    try {
      const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as unknown;
      done(parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {});
    } catch {
      done({});
    }
  });
}
