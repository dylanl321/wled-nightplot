/**
 * A preview of a Look on the yard drawing. This is not the controller, not
 * Preview, and not Apply. When a live read is missing, the caller must say so.
 */
import { parseHexColor } from "./live.ts";
import { resolveLookTarget, type Look, type LookStyle } from "./look.ts";
import { layoutStrings } from "./prop/layout.ts";
import { outputStartForAttachment } from "./prop/design.ts";
import { pathEdgeIndexRanges } from "./prop/sections.ts";
import type { Prop, PropAttachment } from "./prop/types.ts";
import { layoutLightPoints, type LayoutLightPoint } from "./prop/space.ts";

export type LookFrameLight = LayoutLightPoint & {
  propId: string;
  /** `#rrggbb`. Black when this Look leaves the light off. */
  color: string;
};

/** One frame of a Look, for every lit light on the props. */
export function lookFrame(input: { look: Look; props: readonly Prop[]; t: number }): LookFrameLight[] {
  const elapsedMs = Math.max(0, input.t) * 1000;
  const frame: LookFrameLight[] = [];
  for (const prop of input.props) {
    if (!prop.layout) continue;
    const lights = layoutLightPoints(prop.layout);
    const groups = new Map<string, LayoutLightPoint[]>();
    for (const light of lights) {
      const section = sectionAt(prop, light);
      const key = section?.id ?? "";
      const list = groups.get(key) ?? [];
      list.push(light);
      groups.set(key, list);
    }
    for (const [key, group] of groups) {
      const section = key ? prop.sections?.find((row) => row.id === key) : undefined;
      const target = resolveLookTarget(input.look, {
        start: 0,
        stop: Math.max(1, group.length),
        prop,
        ...(section ? { sectionId: section.id, ...(section.color ? { sectionColor: section.color } : {}) } : {}),
      });
      const colours = target.off
        ? group.map(() => "#000000")
        : approximateWledColours({ ...styleInput(target.style), ledCount: group.length, on: true, elapsedMs });
      group.forEach((light, index) => {
        frame.push({ propId: prop.id, ...light, color: colours[index] ?? "#000000" });
      });
    }
  }
  return frame;
}

export type YardLiveFeed = { lightId: string; leds: readonly (string | null)[] | null };

/**
 * The colour a controller just reported for one light. Null when there is
 * no attachment, the read is missing, or this light is not on that output.
 * Null is not black and not the preview.
 */
export function yardLiveColour(input: {
  propId: string;
  stringId: string;
  index: number;
  props: readonly Prop[];
  attachments: readonly PropAttachment[];
  outputs: readonly { lightId: string; outputId: string; start: number }[];
  feed: readonly YardLiveFeed[];
}): string | null {
  const prop = input.props.find((row) => row.id === input.propId);
  const attachment = input.attachments.find((row) => row.propId === input.propId);
  if (!prop?.layout || !attachment) return null;
  const first = layoutStrings(prop.layout)[0]?.id ?? "s1";
  if (input.stringId !== first) return null;
  const row = input.feed.find((item) => item.lightId === attachment.lightId);
  if (!row || row.leds == null) return null;
  const output = input.outputs.find((item) => item.lightId === attachment.lightId && item.outputId === attachment.outputId);
  if (!output) return null;
  const start = outputStartForAttachment({ attachment, props: input.props, attachments: input.attachments });
  if (start == null) return null;
  const colour = row.leds[output.start + start + input.index];
  if (typeof colour !== "string" || !/^#[0-9a-fA-F]{6}$/.test(colour)) return null;
  return colour.toLowerCase();
}

type ApproxInput = {
  ledCount: number;
  on: boolean;
  brightness: number;
  fx: number;
  pal: number;
  speed: number;
  intensity: number;
  color: string;
  color2?: string;
  elapsedMs: number;
};

/** A small, deterministic stand-in for the WLED effects Nightplot sends. */
export function approximateWledColours(input: ApproxInput): string[] {
  const count = Math.max(0, Math.floor(input.ledCount));
  if (!input.on || count === 0) return Array.from({ length: count }, () => "#000000");
  const brightness = clamp01(input.brightness / 255);
  const speed = clamp01(input.speed / 255);
  const intensity = clamp01(input.intensity / 255);
  const elapsed = Math.max(0, input.elapsedMs);
  const phase = ((elapsed / Math.max(240, 2400 - speed * 2100)) % 1 + 1) % 1;
  const effect = effectName(input.fx);
  const palette = paletteColours(input);
  const output: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const position = count <= 1 ? 0 : index / (count - 1);
    let color = paletteAt(palette, position);
    let level = brightness;
    if (effect === "rainbow") {
      color = hsvToRgb((position + phase) % 1, 1, 1);
    } else if (effect === "breathe") {
      level *= 0.12 + 0.88 * triangle(phase);
    } else if (effect === "twinkle") {
      const tick = Math.floor(elapsed / Math.max(70, 520 - speed * 430));
      const roll = unitHash(index, tick);
      level *= roll < 0.05 + intensity * 0.42 ? 1 : 0.05;
      color = palette[index % palette.length] ?? color;
    } else if (effect === "chase" || effect === "running") {
      const head = phase * count;
      const distance = wrappedDistance(index, head, count);
      const width = Math.max(1, Math.round(1 + intensity * Math.max(2, count * 0.16)));
      level *= distance < width ? 1 - distance / Math.max(1, width) : 0.035;
      color = palette[index % palette.length] ?? color;
    } else if (effect === "rain") {
      const tick = Math.floor(elapsed / Math.max(80, 520 - speed * 400));
      const gap = Math.max(4, Math.round(count / 6));
      level *= (index + tick) % gap === 0 ? 1 : 0.08;
    } else if (effect !== "solid") {
      color = paletteAt(palette, (position + phase * (0.2 + speed)) % 1);
      level *= 0.65 + 0.35 * triangle((phase + position * (1 + intensity * 3)) % 1);
    }
    output.push(level <= 0.001 ? "#000000" : scaleHex(color, level));
  }
  return output;
}

function styleInput(style: LookStyle): Omit<ApproxInput, "ledCount" | "on" | "elapsedMs"> {
  return {
    brightness: style.bri,
    fx: style.fx,
    pal: style.pal,
    speed: style.sx,
    intensity: style.ix,
    color: style.color,
    ...(style.color2 ? { color2: style.color2 } : {}),
  };
}

function sectionAt(prop: Prop, light: LayoutLightPoint): { id: string; color?: string } | undefined {
  if (!prop.layout || !prop.sections?.length) return undefined;
  const ranges = pathEdgeIndexRanges(prop.layout);
  const edge = ranges.find((row) => row.edgeId === light.edgeId && row.stringId === light.stringId);
  if (!edge || light.index < edge.start || light.index >= edge.stop) return undefined;
  return prop.sections.find((section) => section.edgeIds.includes(light.edgeId));
}

function effectName(fx: number): "solid" | "breathe" | "rainbow" | "chase" | "running" | "twinkle" | "rain" | "other" {
  switch (fx) {
    case 0: return "solid";
    case 2: return "breathe";
    case 9: return "rainbow";
    case 13: return "chase";
    case 15: return "running";
    case 17: return "twinkle";
    case 43: return "rain";
    default: return "other";
  }
}

function paletteColours(input: ApproxInput): Rgb[] {
  if (input.pal === 11) {
    return [[255, 0, 0], [255, 128, 0], [255, 255, 0], [0, 255, 0], [0, 128, 255], [96, 0, 255]];
  }
  const colours = [input.color, input.color2].flatMap((value) => {
    const rgb = value ? rgbOf(value) : null;
    return rgb && rgb[0] + rgb[1] + rgb[2] > 0 ? [rgb] : [];
  });
  return colours.length > 0 ? colours : [[255, 255, 255]];
}

type Rgb = [number, number, number];

function paletteAt(colors: readonly Rgb[], position: number): Rgb {
  if (colors.length === 1) return colors[0]!;
  const scaled = clamp01(position) * colors.length;
  const from = Math.floor(scaled) % colors.length;
  const to = (from + 1) % colors.length;
  const t = scaled - Math.floor(scaled);
  const left = colors[from]!;
  const right = colors[to]!;
  return [
    Math.round(left[0] + (right[0] - left[0]) * t),
    Math.round(left[1] + (right[1] - left[1]) * t),
    Math.round(left[2] + (right[2] - left[2]) * t),
  ];
}

function scaleHex(color: Rgb, level: number): string {
  return hex(Math.round(color[0] * level), Math.round(color[1] * level), Math.round(color[2] * level));
}

function hsvToRgb(h: number, s: number, v: number): Rgb {
  const section = h * 6;
  const i = Math.floor(section);
  const f = section - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const channels = [
    [v, t, p],
    [q, v, p],
    [p, v, t],
    [p, q, v],
    [t, p, v],
    [v, p, q],
  ][i % 6]!;
  return [Math.round(channels[0]! * 255), Math.round(channels[1]! * 255), Math.round(channels[2]! * 255)];
}

function rgbOf(hexColour: string): Rgb | null {
  const parsed = parseHexColor(hexColour);
  if (!parsed) return null;
  return [parseInt(parsed.slice(1, 3), 16), parseInt(parsed.slice(3, 5), 16), parseInt(parsed.slice(5, 7), 16)];
}

function hex(r: number, g: number, b: number): string {
  return `#${byte(r)}${byte(g)}${byte(b)}`;
}

function byte(value: number): string {
  return Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0");
}

function unitHash(index: number, tick: number): number {
  let value = Math.imul(index + 1, 0x45d9f3b) ^ Math.imul(tick + 17, 0x27d4eb2d);
  value ^= value >>> 16;
  value = Math.imul(value, 0x45d9f3b);
  value ^= value >>> 16;
  return (value >>> 0) / 0x1_0000_0000;
}

function wrappedDistance(index: number, head: number, count: number): number {
  const direct = Math.abs(index - head);
  return Math.min(direct, Math.max(0, count - direct));
}

function triangle(value: number): number {
  return value <= 0.5 ? value * 2 : (1 - value) * 2;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}
