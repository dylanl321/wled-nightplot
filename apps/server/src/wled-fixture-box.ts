import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { WLED_FW1906_NATIVE_TYPE, WLED_SK6812_RGBW_NATIVE_TYPE, WLED_WS281X_NATIVE_TYPE } from "@nightplot/shared";

/** WLED reports `leds.rgbw` for any bus with a white channel (`hasWhite`). */
const WHITE_NATIVE_TYPES: ReadonlySet<number> = new Set([WLED_SK6812_RGBW_NATIVE_TYPE, WLED_FW1906_NATIVE_TYPE]);

export type FixtureBoxKind = "fixture" | "sim";

export type FixtureBoxOptions = {
  /** WLED `leds.maxseg`; ESP32 builds report 32. */
  maxSegments?: number;
  name?: string;
  ver?: string;
  ledCount?: number;
  gpio?: number;
  /** WLED `hw.led.ins[0].type`. Default `TYPE_WS2812_RGB` (22). */
  nativeType?: number;
  /** WLED `hw.led.ins[0].order`. Default `COL_ORDER_GRB` (0). */
  nativeOrder?: number;
  /** Extra / replacement `hw.led.ins[]` rows. When set, `ledCount` is the sum. */
  buses?: Array<{ len: number; pin?: number; type?: number; order?: number }>;
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
  let exportedLedmap: string | null = null;
  let lastUploadName: string | null = null;
  const gpio = options.gpio ?? 16;
  const nativeType = options.nativeType ?? WLED_WS281X_NATIVE_TYPE;
  const nativeOrder = options.nativeOrder ?? 0;
  const initialBuses: BusIns[] = (options.buses?.length
    ? options.buses
    : [{ len: options.ledCount ?? 60, pin: gpio, type: nativeType, order: nativeOrder }]
  ).reduce<BusIns[]>((rows, bus) => {
    const start = rows.reduce((sum, row) => sum + row.len, 0);
    rows.push({
      start,
      len: Math.max(1, Math.round(bus.len)),
      pin: [bus.pin ?? gpio],
      type: bus.type ?? nativeType,
      order: bus.order ?? nativeOrder,
      rev: false,
      skip: 0,
    });
    return rows;
  }, []);
  let ledCount = initialBuses.reduce((sum, bus) => sum + bus.len, 0);
  const info = {
    ver: options.ver ?? "0.15.4",
    name: options.name ?? "WLED",
    mac: "020000000001",
    brand: "WLED",
    product: "FOSS",
    uptime: 3920,
    freeheap: 115000,
    wifi: { signal: 78, rssi: -62 },
    leds: { count: ledCount, rgbw: initialBuses.some((bus) => WHITE_NATIVE_TYPES.has(bus.type)), maxseg: options.maxSegments ?? 32 },
  };
  const cfgEnabled = options.cfgEnabled ?? true;
  type FixtureTimer = {
    en: boolean;
    hour: number;
    min: number;
    macro: number;
    dow: number;
    start?: { mon: number; day: number };
    end?: { mon: number; day: number };
  };
  const emptyTimer = (): FixtureTimer => ({
    en: false, hour: 0, min: 0, macro: 0, dow: 127, start: { mon: 1, day: 1 }, end: { mon: 12, day: 31 },
  });
  const cfg: {
    id: { name: string };
    def: { on: boolean; bri: number; ps: number };
    light: { tr: { dur: number } };
    hw: { led: { maxpwr: number; total: number; ins: BusIns[] } };
    if: {
      sync: { port0: number; port1: number; recv: Record<string, boolean | number>; send: Record<string, boolean | number> };
      ntp: { en: boolean; host: string; tz: number; offset: number; ampm: boolean; ln: number; lt: number };
    };
    timers: { ins: FixtureTimer[] };
  } = {
    // WLED defaults (cfg.cpp): broadcast off, receive group 1 with every field.
    if: {
      sync: { port0: 21324, port1: 65506,
        recv: { bri: true, col: true, fx: true, pal: true, grp: 1, seg: false, sb: false },
        send: { en: false, dir: false, btn: false, va: false, hue: true, grp: 1, ret: 0 } },
      ntp: { en: false, host: "1.wled.pool.ntp.org", tz: 0, offset: 0, ampm: false, ln: 0, lt: 0 },
    },
    timers: { ins: Array.from({ length: 10 }, () => emptyTimer()) },
    id: { name: info.name },
    def: { on: true, bri: 128, ps: 0 },
    light: { tr: { dur: 7 } },
    hw: {
      led: {
        maxpwr: 850,
        total: ledCount,
        ins: initialBuses.map((bus) => ({ ...bus })),
      },
    },
  };
  const state: { on: boolean; bri: number; ps: number; seg: Seg[] } = {
    on: true,
    bri: 140,
    ps: -1,
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

  function resizeCanvas(nextCount: number) {
    const count = Math.max(1, Math.min(2048, Math.round(nextCount)));
    ledCount = count;
    info.leds.count = count;
    cfg.hw.led.total = count;
    const col = state.seg[0]?.col ?? [[255, 160, 0]];
    state.seg = [{ start: 0, stop: count, col }];
    while (pixels.length < count) pixels.push("#000000");
    pixels.length = count;
  }

  function applyIns(rows: unknown[]) {
    const next: BusIns[] = [];
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      if (!row || typeof row !== "object") continue;
      const incoming = row as Record<string, unknown>;
      const prev = cfg.hw.led.ins[i];
      next.push({
        start:
          typeof incoming.start === "number"
            ? Math.max(0, Math.round(incoming.start))
            : (prev?.start ?? 0),
        len:
          typeof incoming.len === "number"
            ? Math.max(1, Math.min(2048, Math.round(incoming.len)))
            : (prev?.len ?? 1),
        pin:
          Array.isArray(incoming.pin) && typeof incoming.pin[0] === "number"
            ? [Math.round(incoming.pin[0])]
            : (prev?.pin ?? [gpio]),
        type: typeof incoming.type === "number" ? Math.round(incoming.type) : (prev?.type ?? nativeType),
        order: typeof incoming.order === "number" ? Math.round(incoming.order) : (prev?.order ?? nativeOrder),
        rev: typeof incoming.rev === "boolean" ? incoming.rev : (prev?.rev ?? false),
        skip: typeof incoming.skip === "number" ? Math.round(incoming.skip) : (prev?.skip ?? 0),
      });
    }
    if (next.length === 0) return;
    cfg.hw.led.ins = next;
    info.leds.rgbw = next.some((bus) => WHITE_NATIVE_TYPES.has(bus.type));
    const total = next.reduce((sum, bus) => sum + bus.len, 0);
    if (infoCountLag) {
      cfg.hw.led.total = total;
      return;
    }
    resizeCanvas(total);
  }

  function applyCfg(body: unknown) {
    if (!body || typeof body !== "object") return;
    const next = body as {
      id?: { name?: unknown };
      def?: { on?: unknown; bri?: unknown; ps?: unknown };
      light?: { tr?: { dur?: unknown } };
      hw?: { led?: { maxpwr?: unknown; ins?: unknown } };
      if?: {
        sync?: { recv?: Record<string, unknown>; send?: Record<string, unknown> };
        ntp?: Record<string, unknown>;
      };
      timers?: { ins?: unknown };
    };
    for (const side of ["recv", "send"] as const) {
      const incoming = next.if?.sync?.[side];
      if (!incoming || typeof incoming !== "object") continue;
      for (const [key, value] of Object.entries(incoming)) {
        if (key in cfg.if.sync[side] && typeof value === typeof cfg.if.sync[side][key]) cfg.if.sync[side][key] = value as boolean | number;
      }
    }
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
    if (Array.isArray(next.hw?.led?.ins) && !busMismatch) {
      applyIns(next.hw.led.ins);
    }
    const ntp = next.if?.ntp;
    if (ntp && typeof ntp === "object") {
      if (typeof ntp.en === "boolean") cfg.if.ntp.en = ntp.en;
      if (typeof ntp.host === "string" && ntp.host.trim()) cfg.if.ntp.host = ntp.host.trim().slice(0, 33);
      if (typeof ntp.tz === "number" && Number.isInteger(ntp.tz)) cfg.if.ntp.tz = ntp.tz;
      if (typeof ntp.offset === "number" && Number.isInteger(ntp.offset)) cfg.if.ntp.offset = ntp.offset;
      if (typeof ntp.ampm === "boolean") cfg.if.ntp.ampm = ntp.ampm;
      if (typeof ntp.ln === "number" && Number.isFinite(ntp.ln)) cfg.if.ntp.ln = ntp.ln;
      if (typeof ntp.lt === "number" && Number.isFinite(ntp.lt)) cfg.if.ntp.lt = ntp.lt;
    }
    if (Array.isArray(next.timers?.ins)) applyTimers(next.timers.ins);
  }

  /**
   * Same index jump as wled00/cfg.cpp (0.15.x): the first hour-255 entry in
   * slots 0–7 lands on slot 8 (sunrise); the next one is slot 9 (sunset).
   */
  function applyTimers(ins: unknown[]) {
    let it = 0;
    for (const row of ins) {
      if (it > 9) break;
      if (!row || typeof row !== "object") continue;
      const incoming = row as Record<string, unknown>;
      const hour = typeof incoming.hour === "number" ? Math.round(incoming.hour) : 0;
      if (it < 8 && hour === 255) it = 8;
      const start = incoming.start && typeof incoming.start === "object" ? incoming.start as { mon?: unknown; day?: unknown } : null;
      const end = incoming.end && typeof incoming.end === "object" ? incoming.end as { mon?: unknown; day?: unknown } : null;
      cfg.timers.ins[it] = {
        en: incoming.en === true,
        hour,
        min: typeof incoming.min === "number" ? Math.round(incoming.min) : 0,
        macro: typeof incoming.macro === "number" ? Math.round(incoming.macro) : 0,
        dow: typeof incoming.dow === "number" ? Math.round(incoming.dow) : 127,
        ...(it < 8 ? {
          start: { mon: typeof start?.mon === "number" ? start.mon : 1, day: typeof start?.day === "number" ? start.day : 1 },
          end: { mon: typeof end?.mon === "number" ? end.mon : 12, day: typeof end?.day === "number" ? end.day : 31 },
        } : {}),
      };
      it += 1;
    }
  }

  /**
   * `cfg` as WLED 0.15.x serializes it: timers with macro, hour and minute
   * all 0 are left out, and `en` is 1 / 0.
   */
  function reportedCfg() {
    const ins = cfg.timers.ins
      .filter((row) => !(row.macro === 0 && row.hour === 0 && row.min === 0))
      .map((row) => ({ ...row, en: row.en ? 1 : 0 }));
    return { ...cfg, timers: { ...cfg.timers, ins } };
  }

  function presetsText(): string {
    return exportedPresets ?? JSON.stringify({ "1": { n: "Fixture preset", on: true, bri: 128, seg: state.seg } });
  }

  /** WLED `ps`: load that slot from presets.json, then report it as current. */
  function applyPreset(id: number) {
    let preset: unknown;
    try { preset = (JSON.parse(presetsText()) as Record<string, unknown>)[String(id)]; }
    catch { return; }
    if (!preset || typeof preset !== "object") return;
    applyState(preset);
    state.ps = id;
  }

  function applyState(body: unknown) {
    if (!body || typeof body !== "object") return;
    const next = body as { on?: unknown; bri?: unknown; seg?: unknown; ps?: unknown };
    if (typeof next.ps === "number" && Number.isInteger(next.ps) && next.ps >= 1 && next.ps <= 250 && next.seg === undefined) {
      applyPreset(next.ps);
      return;
    }
    if (next.seg !== undefined) state.ps = -1;
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
      res.end(exportedCfg ?? JSON.stringify(reportedCfg()));
      return;
    }
    if (url === "/presets.json") {
      res.end(presetsText());
      return;
    }
    if (url === "/ledmap.json") {
      if (exportedLedmap === null) {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: "not_found" }));
        return;
      }
      res.end(exportedLedmap);
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
        if (name.includes("ledmap.json")) exportedLedmap = body;
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
      res.end(JSON.stringify({ ...reportedCfg(), nightplot: kind }));
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
    presets() {
      return presetsText();
    },
    setPresets(raw: string) {
      exportedPresets = raw;
    },
    ledmap() {
      return exportedLedmap;
    },
    setLedmap(raw: string | null) {
      exportedLedmap = raw;
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
