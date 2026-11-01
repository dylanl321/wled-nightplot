/**
 * Screen-space name labels for the yard drawing. Each label prefers to sit
 * centred just above its prop. When that box would cover another label, or
 * the zoom buttons, it steps aside or shortens. The expanded label (the one
 * under the pointer, or the selected prop) keeps its full caption.
 */

export type YardLabelAnchor = {
  id: string;
  /** Top centre of the prop, in stage pixels. */
  x: number;
  y: number;
  text: string;
};

export type YardLabelSlot = {
  id: string;
  x: number;
  y: number;
  width: number;
  text: string;
};

/** Wider than a typical 12 px glyph, so a slot is never narrower than the drawn text. */
const CHAR_PX = 7.5;
const LINE_PX = 16;
const GAP_PX = 4;
const MAX_WIDTH = 188;
const EXPANDED_MAX = 320;
const MIN_WIDTH = 64;
const ABOVE_PX = 22;
/** The zoom buttons sit in this top-right strip. */
const CONTROLS = { w: 60, h: 168 };

export function estimateLabelWidth(text: string): number {
  return Math.ceil(text.length * CHAR_PX);
}

type Box = { x: number; y: number; w: number; h: number };

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w + GAP_PX
    && a.x + a.w + GAP_PX > b.x
    && a.y < b.y + b.h + GAP_PX
    && a.y + a.h + GAP_PX > b.y;
}

function fitText(text: string, width: number): string {
  if (estimateLabelWidth(text) <= width) return text;
  const split = text.indexOf(" · ");
  const name = split >= 0 ? text.slice(0, split) : text;
  if (estimateLabelWidth(name) <= width) return name;
  const ellipsis = "…";
  const budget = Math.max(1, Math.floor((width - estimateLabelWidth(ellipsis)) / CHAR_PX));
  const cut = name.slice(0, budget).trimEnd();
  return `${cut || name.slice(0, 1)}${ellipsis}`;
}

function clampBox(box: Box, stage: { w: number; h: number } | undefined): Box {
  let x = Math.max(2, box.x);
  let y = Math.max(2, box.y);
  if (stage && stage.w > 0) x = Math.min(x, Math.max(2, stage.w - box.w - 2));
  if (stage && stage.h > 0) y = Math.min(y, Math.max(2, stage.h - box.h - 2));
  return { ...box, x, y };
}

export function placeYardLabels(
  anchors: readonly YardLabelAnchor[],
  options?: { expandedId?: string | null; stage?: { w: number; h: number } },
): YardLabelSlot[] {
  const expandedId = options?.expandedId ?? null;
  const stage = options?.stage;
  const occupied: Box[] = [];
  if (stage && stage.w > CONTROLS.w + 40 && stage.h > CONTROLS.h) {
    occupied.push({ x: stage.w - CONTROLS.w, y: 0, w: CONTROLS.w, h: CONTROLS.h });
  }

  const indexed = anchors.map((anchor, index) => ({ ...anchor, index }));
  indexed.sort((a, b) => {
    const rank = (id: string) => (id === expandedId ? 0 : 1);
    const byRank = rank(a.id) - rank(b.id);
    if (byRank !== 0) return byRank;
    return a.y - b.y || a.x - b.x;
  });

  const slots: YardLabelSlot[] = new Array(anchors.length);
  const step = LINE_PX + GAP_PX;
  for (const anchor of indexed) {
    const expanded = anchor.id === expandedId;
    const natural = Math.min(expanded ? EXPANDED_MAX : MAX_WIDTH, Math.max(MIN_WIDTH, estimateLabelWidth(anchor.text)));
    const widths = expanded
      ? [natural]
      : [...new Set([natural, Math.min(natural, 132), Math.min(natural, 96), MIN_WIDTH])];
    let chosen: { x: number; y: number; w: number } | null = null;
    for (const width of widths) {
      const candidates: { x: number; y: number }[] = [];
      for (const lift of [0, 1, 2, 3, 4, 5, 6]) {
        for (const shift of [0, -1, 1, -1.8, 1.8]) {
          candidates.push({
            x: anchor.x - width / 2 + shift * width * 0.55,
            y: anchor.y - ABOVE_PX - lift * step,
          });
        }
      }
      for (const drop of [0, 1, 2, 3]) {
        candidates.push({ x: anchor.x - width / 2, y: anchor.y + 8 + drop * step });
      }
      if (stage && stage.w > CONTROLS.w + width) {
        const clear = stage.w - CONTROLS.w - GAP_PX - width;
        candidates.push({ x: clear, y: anchor.y - ABOVE_PX });
        candidates.push({ x: clear, y: anchor.y + 8 });
      }
      for (const candidate of candidates) {
        const box = clampBox({ x: candidate.x, y: candidate.y, w: width, h: LINE_PX }, stage);
        if (occupied.some((other) => overlaps(box, other))) continue;
        chosen = { x: box.x, y: box.y, w: width };
        occupied.push(box);
        break;
      }
      if (chosen) break;
    }
    if (!chosen) {
      const width = expanded ? natural : MIN_WIDTH;
      const x = clampBox({ x: anchor.x - width / 2, y: anchor.y, w: width, h: LINE_PX }, stage).x;
      let y = anchor.y - ABOVE_PX;
      for (let attempt = 0; attempt < 16; attempt += 1) {
        const box = clampBox({ x, y, w: width, h: LINE_PX }, stage);
        if (!occupied.some((other) => overlaps(box, other))) {
          chosen = { x: box.x, y: box.y, w: width };
          occupied.push(box);
          break;
        }
        y -= step;
      }
      if (!chosen) {
        const box = clampBox({ x, y, w: width, h: LINE_PX }, stage);
        chosen = { x: box.x, y: box.y, w: width };
        occupied.push(box);
      }
    }
    slots[anchor.index] = {
      id: anchor.id,
      x: chosen.x,
      y: chosen.y,
      width: chosen.w,
      text: expanded ? anchor.text : fitText(anchor.text, chosen.w),
    };
  }
  return slots;
}
