/**
 * Handles for designing a split tree on the canvas: the joints, the trunk
 * body (to carry a limb), and the + that forks a tip. Positions are CSS pixels.
 */

import type { PropLayout, SplitTrunk } from "@nightplot/shared";
import type { View } from "./stage";

export type SplitHandleKind = "base" | "fork" | "tip" | "branch" | "sprout";

export type SplitHandle = {
  id: string;
  kind: SplitHandleKind;
  x: number;
  y: number;
  trunkId: string;
};

const ORDER: readonly SplitHandleKind[] = ["sprout", "tip", "fork", "base", "branch"];

function reach(kind: SplitHandleKind, phone: boolean): number {
  if (kind === "sprout") return phone ? 28 : 22;
  if (kind === "branch") return phone ? 30 : 18;
  return phone ? 28 : 18;
}

function screenAt(view: View, layout: PropLayout, id: string): { x: number; y: number } | null {
  const corner = layout.corners.find((row) => row.id === id);
  if (!corner) return null;
  return { x: view.sx(corner.x), y: view.sy(corner.y) };
}

/** Every handle on the tree, in screen pixels. Branch marks are for grabbing the limb, not drawn. */
export function collectSplitHandles(
  view: View,
  layout: PropLayout,
  trunks: readonly SplitTrunk[],
  phone: boolean,
): SplitHandle[] {
  const handles: SplitHandle[] = [];
  const hasChild = new Set(trunks.map((trunk) => trunk.parentId).filter((id): id is string => id != null));
  const base = screenAt(view, layout, "c-base");
  if (base) handles.push({ id: "joint:base", kind: "base", x: base.x, y: base.y, trunkId: "t0" });
  for (const trunk of trunks) {
    const end = screenAt(view, layout, `c-${trunk.id}`);
    const start = screenAt(view, layout, trunk.parentId ? `c-${trunk.parentId}` : "c-base");
    if (!end || !start) continue;
    const fork = hasChild.has(trunk.id);
    handles.push({
      id: `joint:${trunk.id}`,
      kind: fork ? "fork" : "tip",
      x: end.x,
      y: end.y,
      trunkId: trunk.id,
    });
    if (!fork) {
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const len = Math.hypot(dx, dy) || 1;
      const dist = phone ? 68 : 54;
      const px = -dy / len;
      const py = dx / len;
      const left = { x: end.x + px * dist, y: end.y + py * dist };
      const right = { x: end.x - px * dist, y: end.y - py * dist };
      let ax = 0;
      let ay = 0;
      let count = 0;
      for (const other of trunks) {
        if (other.id === trunk.id || hasChild.has(other.id)) continue;
        const tip = screenAt(view, layout, `c-${other.id}`);
        if (!tip) continue;
        ax += tip.x;
        ay += tip.y;
        count += 1;
      }
      const away = count > 0 ? { x: ax / count, y: ay / count } : start;
      const leftFar = Math.hypot(left.x - away.x, left.y - away.y);
      const rightFar = Math.hypot(right.x - away.x, right.y - away.y);
      const spot = leftFar >= rightFar ? left : right;
      const marginTop = phone ? 72 : 52;
      handles.push({
        id: `sprout:${trunk.id}`,
        kind: "sprout",
        x: Math.min(view.W - 20, Math.max(20, spot.x)),
        y: Math.min(view.H - 24, Math.max(marginTop, spot.y)),
        trunkId: trunk.id,
      });
    }
    for (const t of [0.34, 0.55, 0.76]) {
      handles.push({
        id: `branch:${trunk.id}`,
        kind: "branch",
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t,
        trunkId: trunk.id,
      });
    }
  }
  return handles;
}

/** The handle under the pointer, joints before the trunk body. */
export function hitSplitHandle(handles: readonly SplitHandle[], px: number, py: number, phone: boolean): SplitHandle | null {
  for (const kind of ORDER) {
    const slop = reach(kind, phone);
    for (const handle of handles) {
      if (handle.kind !== kind) continue;
      if (Math.hypot(handle.x - px, handle.y - py) <= slop) return handle;
    }
  }
  return null;
}

type HandleColours = { pick: string; card: string; fg: string; primary: string };

/** Circles for crotches, diamonds for tips, + to fork. */
export function drawSplitHandles(
  ctx: CanvasRenderingContext2D,
  handles: readonly SplitHandle[],
  selected: string | null,
  phone: boolean,
  colours: HandleColours,
): void {
  const drawn = handles.filter((handle) => handle.kind !== "branch");
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (const handle of drawn) {
    const trunk = selected?.startsWith("branch:") || selected?.startsWith("joint:") ? selected.split(":")[1] : null;
    const on = selected === handle.id || (trunk === handle.trunkId && (handle.kind === "fork" || handle.kind === "tip" || handle.kind === "base"));
    const r = (phone ? 16 : 12) + (on ? 3 : 0);
    ctx.beginPath();
    if (handle.kind === "tip") {
      ctx.moveTo(handle.x, handle.y - r);
      ctx.lineTo(handle.x + r, handle.y);
      ctx.lineTo(handle.x, handle.y + r);
      ctx.lineTo(handle.x - r, handle.y);
      ctx.closePath();
    } else {
      ctx.arc(handle.x, handle.y, handle.kind === "sprout" ? r - 2 : r, 0, Math.PI * 2);
    }
    if (handle.kind === "sprout") {
      ctx.fillStyle = colours.card;
      ctx.fill();
      ctx.strokeStyle = colours.primary;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.strokeStyle = colours.fg;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(handle.x - 6, handle.y);
      ctx.lineTo(handle.x + 6, handle.y);
      ctx.moveTo(handle.x, handle.y - 6);
      ctx.lineTo(handle.x, handle.y + 6);
      ctx.stroke();
    } else {
      ctx.fillStyle = colours.card;
      ctx.fill();
      ctx.strokeStyle = handle.kind === "base" ? colours.fg : colours.pick;
      ctx.lineWidth = on ? 4 : 2.5;
      ctx.stroke();
    }
    if (on) {
      ctx.beginPath();
      ctx.arc(handle.x, handle.y, r + (phone ? 10 : 8), 0, Math.PI * 2);
      ctx.strokeStyle = colours.pick;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
  ctx.restore();
}
