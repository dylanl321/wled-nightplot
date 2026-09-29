import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { WLED_SK6812_RGBW_NATIVE_TYPE, WLED_WS281X_NATIVE_TYPE } from "@nightplot/shared";

export type FixtureBoxKind = "fixture" | "sim";

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
  /** In-process fixture vs external-process sim. Default `fixture`. */
  kind?: FixtureBoxKind;
  /** Omit `state.seg` on GET so Apply reread stays unknown. */
  unknownReread?: boolean;
  /** POST /json/state returns not-ok (All Off / live write fail). */
  refuseState?: boolean;
};

type Seg = {
  id?: number; start: number; stop: number; col: number[][];
  i?: (number | string)[]; frz?: boolean; [key: string]: unknown;
};
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
  let exportedCfg: string | null = null;
  let exportedPresets: string | null = null;
  let lastUploadName: string | null = null;
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
    uptime: 3920,
    freeheap: 115000,
    wifi: { signal: 78, rssi: -62 },
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
  const kind: FixtureBoxKind = options.kind === "sim" ? "sim" : "fixture";
  let mismatch = options.mismatch ?? false;
  let busMismatch = options.busMismatch ?? false;
  let infoCountLag = options.infoCountLag ?? false;
  let infoNameLag = options.infoNameLag ?? false;
  let unknownReread = options.unknownReread ?? false;
  let hideSegAfterWrite = false;
  let refuseState = options.refuseState ?? false;

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
    const incoming: {
      id: number | null;
      start: number;
      stop: number;
      col: number[][] | null;
      extra: Record<string, unknown>;
    }[] = [];
    for (const raw of next.seg) {
      if (!raw || typeof raw !== "object") continue;
      const row = raw as { id?: unknown; start?: unknown; stop?: unknown; col?: unknown };
      const start = typeof row.start === "number" ? row.start : 0;
      const stop = typeof row.stop === "number" ? row.stop : ledCount;
      if (!Number.isFinite(start) || !Number.isFinite(stop)) continue;
      const col = Array.isArray(row.col) && Array.isArray(row.col[0]) ? (row.col as number[][]) : null;
      incoming.push({
        id: typeof row.id === "number" ? row.id : null,
        start,
        stop,
        col,
        extra: raw as Record<string, unknown>,
      });
    }
    // WLED `deserializeSegment`: `id = elem["id"] | it` (ArduinoJson default —
    // named id, else array index). Rows apply in that order. A later leftover
    // `id: 1` `stop: 0` can delete a just-inferred second unnamed range.
    // Leftover pre-pass before inferred apply was the fixture gap (CONFIG-143).
    // Unmentioned leftover overlay ids stay. Fixture stand-in — not metal.
    const byId = new Map<number, Seg>();
    state.seg.forEach((seg, index) => {
      byId.set(seg.id ?? index, { ...seg, id: seg.id ?? index });
    });
    incoming.forEach((row, it) => {
      const id = row.id ?? it;
      if (row.stop <= row.start) {
        const found = byId.get(id);
        if (found) {
          paint(pixels, found.start, found.stop, [0, 0, 0]);
          byId.delete(id);
        }
        return;
      }
      const prev = byId.get(id);
      const col = row.col ?? prev?.col ?? state.seg[0]?.col ?? [];
      const merged: Seg = { ...prev, ...row.extra, id, start: row.start, stop: row.stop, col };
      if (Array.isArray(row.extra.i)) {
        merged.i = row.extra.i as (number | string)[];
        merged.frz = true;
        // WLED processes pixel writes in array order, including an intermediate
        // clear followed by restoration of the same segment ID.
        paintIndividual(merged);
      } else if (row.extra.frz === false) delete merged.i;
      byId.set(id, merged);
    });
    let segs = [...byId.values()].sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
    if (mismatch && segs.length > 0) {
      const last = segs[segs.length - 1]!;
      last.stop = Math.max(last.start + 1, last.stop - 10);
    }
    if (segs.length) state.seg = segs;
    for (const seg of state.seg) {
      const rgb = seg.col[0];
      if (rgb) paint(pixels, seg.start, seg.stop, rgb);
      paintIndividual(seg);
    }
    if (unknownReread) hideSegAfterWrite = true;
  }

  function paintIndividual(seg: Seg) {
    let start = 0;
    let stop: number | null = null;
    let hasStart = false;
    for (const item of seg.i ?? []) {
      if (typeof item === "number") {
        if (!hasStart) { start = item; hasStart = true; } else stop = item;
      } else {
        const value = item.slice(-6);
        paint(pixels, seg.start + start, seg.start + (stop ?? start + 1),
          [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16)));
        start = (stop ?? start + 1); stop = null; hasStart = false;
      }
    }
  }

  function liveLeds(): string[] {
    if (!state.on) return pixels.map(() => "#000000");
    return pixels.slice();
  }

  function reportedState() {
    if (unknownReread && hideSegAfterWrite) return { on: state.on, bri: state.bri };
    return {
      ...state,
      seg: state.seg.map((segment, index) => {
        const { i: _pixels, ...reported } = segment;
        return {
          id: index, frz: false, on: true, bri: 255, grp: 1, spc: 0, of: 0, rev: false, mi: false,
          ...reported,
        };
      }),
    };
  }

  function paintDdp(offsetBytes: number, rgb: Uint8Array) {
    const start = Math.max(0, Math.floor(offsetBytes / 3));
    for (let i = 0; i + 2 < rgb.length; i += 3) {
      const index = start + i / 3;
      if (index >= pixels.length) break;
      pixels[index] = `#${[rgb[i], rgb[i + 1], rgb[i + 2]]
        .map((n) => Math.max(0, Math.min(255, n ?? 0)).toString(16).padStart(2, "0"))
        .join("")}`;
    }
  }

  function setInfoNameLag(on: boolean) {
    infoNameLag = on;
    if (!infoNameLag) info.name = cfg.id.name;
  }

  function handle(req: IncomingMessage, res: ServerResponse) {
    const url = req.url ?? "/";
    res.setHeader("Content-Type", "application/json");

    if (url === "/json") {
      res.end(JSON.stringify({ info, state: reportedState(), nightplot: kind }));
      return;
    }
    if (url === "/cfg.json") {
      res.end(exportedCfg ?? JSON.stringify(cfg));
      return;
    }
    if (url === "/presets.json") {
      res.end(exportedPresets ?? JSON.stringify({ "1": { n: "Fixture preset", on: true, bri: 128, seg: state.seg } }));
      return;
    }
    if (url === "/upload" && (req.method === "POST" || req.method === "PUT")) {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk as Buffer));
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        const name = /filename="([^"]+)"/.exec(raw)?.[1] ?? "";
        const start = raw.indexOf("\r\n\r\n");
        const body = start >= 0 ? raw.slice(start + 4).replace(/\r\n--[\s\S]*$/, "") : raw;
        lastUploadName = name;
        if (name.includes("presets.json")) exportedPresets = body;
        if (name.includes("cfg.json")) {
          exportedCfg = body;
          try {
            const parsed = JSON.parse(body) as Record<string, unknown>;
            applyCfg(parsed);
          } catch { /* keep the exact uploaded text */ }
        }
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/plain");
        res.end(name.includes("cfg.json")
          ? "Configuration restore successful.\nRebooting..."
          : "File Uploaded!");
      });
      return;
    }
    if (url === "/json/info") {
      res.end(JSON.stringify({ ...info, nightplot: kind }));
      return;
    }
    if (url === "/json/live") {
      res.end(
        JSON.stringify({
          leds: liveLeds().map((hex) => hex.slice(1)),
          nightplot: kind,
        }),
      );
      return;
    }
    if (url === "/nightplot/mismatch") {
      if (req.method === "POST" || req.method === "PUT") {
        readJson(req, (body) => {
          if (typeof body.on === "boolean") mismatch = body.on;
          res.end(JSON.stringify({ mismatch, nightplot: kind }));
        });
        return;
      }
      res.end(JSON.stringify({ mismatch, nightplot: kind }));
      return;
    }
    if (url === "/nightplot/unknown-reread") {
      if (req.method === "POST" || req.method === "PUT") {
        readJson(req, (body) => {
          if (typeof body.on === "boolean") {
            unknownReread = body.on;
            if (!unknownReread) hideSegAfterWrite = false;
          }
          res.end(JSON.stringify({ unknownReread, nightplot: kind }));
        });
        return;
      }
      res.end(JSON.stringify({ unknownReread, nightplot: kind }));
      return;
    }
    if (url === "/nightplot/refuse-state") {
      if (req.method === "POST" || req.method === "PUT") {
        readJson(req, (body) => {
          if (typeof body.on === "boolean") refuseState = body.on;
          res.end(JSON.stringify({ refuseState, nightplot: kind }));
        });
        return;
      }
      res.end(JSON.stringify({ refuseState, nightplot: kind }));
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
              nightplot: kind,
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
          nightplot: kind,
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
          res.end(JSON.stringify({ success: true, nightplot: kind }));
        });
        return;
      }
      res.end(JSON.stringify({ ...cfg, nightplot: kind }));
      return;
    }
    if (url === "/json/state") {
      if (req.method === "POST" || req.method === "PUT") {
        if (refuseState) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: "refused", nightplot: kind }));
          return;
        }
        readJson(req, (body) => {
          applyState(body);
          res.end(JSON.stringify({ success: true, state: reportedState(), nightplot: kind }));
        });
        return;
      }
      res.end(JSON.stringify(reportedState()));
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
    get kind() {
      return kind;
    },
    get unknownReread() {
      return unknownReread;
    },
    get refuseState() {
      return refuseState;
    },
    applyCfg,
    paintDdp,
    setUnknownReread(on: boolean) {
      unknownReread = on;
      if (!on) hideSegAfterWrite = false;
    },
    setRefuseState(on: boolean) {
      refuseState = on;
    },
    setInfoNameLag,
    setBusMismatch(on: boolean) {
      busMismatch = on;
    },
    get lastUploadName() {
      return lastUploadName;
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
