import { isLitBead, isUnknownBead, type BeadColor } from "@nightplot/shared";
import { createElement, type ReactNode } from "react";

export type StripSpan = {
  start: number;
  stop: number;
  label?: string;
  sel?: boolean;
  error?: boolean;
  differs?: boolean;
};

export type StripRegion = {
  start: number;
  stop: number;
  kind: "drift" | "error" | "sel";
};

export type StripBeadsProps = {
  id: string;
  count: number;
  color: (index: number) => BeadColor;
  pitch?: number;
  perRow?: number;
  gutter?: number;
  top?: number;
  bottom?: number;
  gap?: number;
  brightness?: number;
  declared?: StripSpan[];
  reported?: StripSpan[];
  regions?: StripRegion[];
  rgbw?: boolean;
  handles?: boolean;
  fontSize?: number;
  ariaLabel?: string;
};

/**
 * Glowing LED beads on a dark rail. This is the only place bead language lives.
 * Unreachable beads stay grey. Off beads stay dark. Never paint a last-seen colour.
 */
export function StripBeads(props: StripBeadsProps) {
  return stripSvg(props);
}

function stripSvg(o: StripBeadsProps) {
  const h = createElement;
  const pitch = o.pitch ?? 11;
  const s = pitch / 11;
  const per = o.perRow ?? o.count;
  const gut = o.gutter ?? 30;
  const pad = 6;
  const top = o.top ?? 30;
  const bot = o.bottom ?? 22;
  const gap = o.gap ?? 4;
  const band = 13 * s;
  const rowH = top + band * 2 + bot;
  const rows = Math.ceil(o.count / per);
  const W = gut + pad * 2 + per * pitch;
  const H = rows * rowH + (rows - 1) * gap;
  const id = o.id;
  const bri = o.brightness ?? 1;
  const fs = o.fontSize ?? (s < 0.75 ? 9 : 10.5);
  const rowTop = (r: number) => r * (rowH + gap);
  const cy = (r: number) => rowTop(r) + top + band;
  const xAt = (i: number) => gut + pad + (i % per) * pitch;
  const xEnd = (i: number) => xAt(i - 1) + pitch;
  const pieces = (a: number, b: number) => {
    const out: { r: number; a: number; b: number }[] = [];
    let i = a;
    while (i < b) {
      const r = Math.floor(i / per);
      const e = Math.min(b, (r + 1) * per);
      out.push({ r, a: i, b: e });
      i = e;
    }
    return out;
  };

  const defs: ReactNode[] = [
    h(
      "linearGradient",
      { key: "pcb", id: `${id}-pcb`, x1: 0, y1: 0, x2: 0, y2: 1 },
      h("stop", { offset: "0%", stopColor: "#20242c" }),
      h("stop", { offset: "45%", stopColor: "#171a21" }),
      h("stop", { offset: "100%", stopColor: "#0e1015" }),
    ),
  ];
  const cols = new Set<string>();
  for (let i = 0; i < o.count; i++) {
    const c = o.color(i);
    if (isLitBead(c)) cols.add(c);
  }
  const gid = (c: string) => `${id}-g${c.slice(1)}`;
  cols.forEach((c) =>
    defs.push(
      h(
        "radialGradient",
        { key: c, id: gid(c), cx: "50%", cy: "50%", r: "50%" },
        h("stop", { offset: "0%", stopColor: c, stopOpacity: 0.95 }),
        h("stop", { offset: "22%", stopColor: c, stopOpacity: 0.6 }),
        h("stop", { offset: "55%", stopColor: c, stopOpacity: 0.16 }),
        h("stop", { offset: "100%", stopColor: c, stopOpacity: 0 }),
      ),
    ),
  );

  const k: ReactNode[] = [];
  const bloom: ReactNode[] = [];
  for (let r = 0; r < rows; r++) {
    const n = Math.min(per, o.count - r * per);
    const y = cy(r);
    const bh = 9 * s;
    k.push(
      h("rect", {
        key: "b" + r,
        x: gut + pad - 1,
        y: y - bh / 2,
        width: n * pitch + 2,
        height: bh,
        rx: 1.5,
        fill: `url(#${id}-pcb)`,
        stroke: "#2a2e38",
        strokeWidth: 0.8,
      }),
    );
    k.push(
      h("line", {
        key: "c1" + r,
        x1: gut + pad,
        y1: y - bh / 2 + 2 * s,
        x2: gut + pad + n * pitch,
        y2: y - bh / 2 + 2 * s,
        stroke: "#8a6848",
        strokeWidth: 0.7,
        opacity: 0.5,
      }),
    );
    k.push(
      h("line", {
        key: "c2" + r,
        x1: gut + pad,
        y1: y + bh / 2 - 2 * s,
        x2: gut + pad + n * pitch,
        y2: y + bh / 2 - 2 * s,
        stroke: "#8a6848",
        strokeWidth: 0.7,
        opacity: 0.4,
      }),
    );
    if (gut) {
      k.push(
        h(
          "text",
          {
            key: "ix" + r,
            x: 0,
            y: y + 3.5,
            fontSize: fs,
            fill: "#7d7870",
            fontFamily: "IBM Plex Mono",
          },
          String(r * per).padStart(3, "0"),
        ),
      );
    }
  }

  const tones = { drift: "#d4a574", error: "#e07070", sel: "#d4a574" } as const;
  const regs: ReactNode[] = [];
  (o.regions ?? []).forEach((g, gi) =>
    pieces(g.start, g.stop).forEach((p, pi) => {
      const t = tones[g.kind];
      const y = cy(p.r);
      regs.push(
        h("rect", {
          key: `rg${gi}-${pi}`,
          x: xAt(p.a) + 0.5,
          y: y - band * 0.95,
          width: (p.b - p.a) * pitch - 1,
          height: band * 1.9,
          rx: 3,
          fill: t,
          fillOpacity: g.kind === "error" ? 0.18 : g.kind === "sel" ? 0.06 : 0.07,
          stroke: t,
          strokeOpacity: g.kind === "sel" ? 0.4 : 0.95,
          strokeWidth: 1,
          strokeDasharray: g.kind === "drift" ? "3 2" : undefined,
        }),
      );
    }),
  );

  const railN = k.length;
  for (let i = 0; i < o.count; i++) {
    const c = o.color(i);
    const r = Math.floor(i / per);
    const x = xAt(i) + pitch / 2;
    const y = cy(r);
    const lit = isLitBead(c);
    const unknown = isUnknownBead(c);
    const bl = 5 * s;
    if (lit) {
      bloom.push(
        h("ellipse", {
          key: "g" + i,
          cx: x,
          cy: y,
          rx: pitch * 1.25,
          ry: pitch * 1.45,
          fill: `url(#${gid(c)})`,
          opacity: bri,
        }),
      );
    }
    k.push(
      h("rect", {
        key: "p" + i,
        x: x - bl / 2,
        y: y - bl / 2,
        width: bl,
        height: bl,
        rx: bl * 0.18,
        fill: unknown ? "#2a2926" : lit ? "#efe9dc" : "#3e3c37",
      }),
    );
    if (o.rgbw) {
      k.push(
        h("circle", {
          key: "a" + i,
          cx: x - bl * 0.2,
          cy: y,
          r: bl * 0.2,
          fill: lit ? c : "#141519",
        }),
      );
      k.push(
        h("circle", {
          key: "w" + i,
          cx: x + bl * 0.2,
          cy: y,
          r: bl * 0.2,
          fill: lit ? "#fff4dc" : "#141519",
        }),
      );
    } else {
      k.push(
        h("circle", {
          key: "d" + i,
          cx: x,
          cy: y,
          r: lit ? bl * 0.36 : bl * 0.3,
          fill: lit ? c : unknown ? "#1d1d1f" : "#141519",
          stroke: lit ? "#ffffff" : undefined,
          strokeOpacity: lit ? 0.55 * bri : undefined,
          strokeWidth: lit ? bl * 0.12 : 0,
        }),
      );
    }
  }

  const over: ReactNode[] = [];
  (o.declared ?? []).forEach((sp, si) => {
    const ps = pieces(sp.start, sp.stop);
    const t = sp.error ? "#e07070" : sp.sel || sp.differs ? "#d4a574" : "#9a9488";
    ps.forEach((p, pi) => {
      const y0 = rowTop(p.r) + top - 9;
      const x0 = xAt(p.a) + 1.5;
      const x1 = xEnd(p.b) - 1.5;
      over.push(
        h("path", {
          key: `dp${si}-${pi}`,
          d: `M${x0} ${y0 + 5}V${y0}H${x1}V${y0 + 5}`,
          fill: "none",
          stroke: t,
          strokeWidth: sp.sel ? 1.4 : 1,
          strokeDasharray: sp.differs && !sp.sel ? "3 2" : undefined,
        }),
      );
      if (pi === 0) {
        over.push(
          h(
            "text",
            { key: `dt${si}`, x: x0, y: y0 - 5, fontSize: fs + 0.5 },
            h(
              "tspan",
              {
                fontFamily: "IBM Plex Sans",
                fontWeight: 500,
                fill: sp.sel ? "#d4a574" : "#ece7dc",
              },
              sp.label,
            ),
            h(
              "tspan",
              {
                fontFamily: "IBM Plex Mono",
                fill: sp.error ? "#e07070" : sp.differs ? "#d4a574" : "#9a9488",
                dx: 6,
                fontSize: fs,
              },
              `${sp.start}–${sp.stop}`,
            ),
          ),
        );
      }
    });
    if (sp.sel && o.handles && ps[0] && ps[ps.length - 1]) {
      const f = ps[0];
      const l = ps[ps.length - 1];
      (
        [
          [xAt(f.a), f.r],
          [xEnd(l.b), l.r],
        ] as const
      ).forEach(([hx, hr], hi) => {
        const y0 = rowTop(hr) + top - 9;
        const col = hi === 1 && sp.error ? "#e07070" : "#d4a574";
        over.push(
          h("line", {
            key: `hl${si}${hi}`,
            x1: hx,
            y1: y0,
            x2: hx,
            y2: cy(hr) + band,
            stroke: col,
            strokeWidth: 1.2,
          }),
        );
        over.push(
          h("circle", {
            key: `hc${si}${hi}`,
            cx: hx,
            cy: y0,
            r: 5.5,
            fill: "#0c0d10",
            stroke: col,
            strokeWidth: 1.8,
          }),
        );
      });
    }
  });

  (o.reported ?? []).forEach((sp, si) =>
    pieces(sp.start, sp.stop).forEach((p, pi) => {
      const y1 = cy(p.r) + band + 6;
      const x0 = xAt(p.a) + 1.5;
      const x1 = xEnd(p.b) - 1.5;
      const t = sp.differs ? "#d4a574" : "#3f4552";
      over.push(
        h("path", {
          key: `rp${si}-${pi}`,
          d: `M${x0} ${y1 - 4}V${y1}H${x1}V${y1 - 4}`,
          fill: "none",
          stroke: t,
          strokeWidth: 1,
          strokeDasharray: sp.differs ? "3 2" : undefined,
        }),
      );
      if (sp.differs && pi === pieces(sp.start, sp.stop).length - 1) {
        over.push(
          h(
            "text",
            {
              key: `rt${si}`,
              x: x1,
              y: y1 + fs + 2,
              fontSize: fs,
              fill: "#d4a574",
              fontFamily: "IBM Plex Mono",
              textAnchor: "end",
            },
            `reports ${sp.start}–${sp.stop}`,
          ),
        );
      }
    }),
  );

  return h(
    "svg",
    {
      viewBox: `0 0 ${W} ${H}`,
      width: W,
      height: H,
      role: "img",
      "aria-label": o.ariaLabel ?? "LED strip",
      style: { display: "block", maxWidth: "100%", height: "auto", overflow: "visible" },
    },
    h("defs", null, defs),
    h("g", null, k.slice(0, railN)),
    regs.length ? h("g", null, regs) : null,
    h("g", null, bloom),
    h("g", null, k.slice(railN)),
    over,
  );
}
