/**
 * The split tree as joints you can move. Coordinates are prop units:
 * x across from the ground joint, y up from the ground.
 */

import type { SplitPose, SplitPoseNode } from "./types.ts";

const MIN_BONE = 0.12;
const MIN_SPLIT = 0.15;

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** A copy with only the joints. Older saves also carried wrap meets and back-path knees; those are dropped here. */
function copy(pose: SplitPose): SplitPose {
  return { nodes: pose.nodes.map((node) => ({ ...node })) };
}

export function poseTips(nodes: readonly SplitPoseNode[]): SplitPoseNode[] {
  return nodes.filter((node) => node.id !== "base" && !nodes.some((other) => other.parentId === node.id));
}

function byId(nodes: readonly SplitPoseNode[]): Map<string, SplitPoseNode> {
  return new Map(nodes.map((node) => [node.id, node]));
}

/** The joint and every joint that grows from it. */
export function poseDescendants(nodes: readonly SplitPoseNode[], id: string): Set<string> {
  const ids = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const node of nodes) {
      if (node.parentId && ids.has(node.parentId) && !ids.has(node.id)) {
        ids.add(node.id);
        grew = true;
      }
    }
  }
  return ids;
}

function separated(nodes: readonly SplitPoseNode[]): boolean {
  const ids = byId(nodes);
  for (const node of nodes) {
    if (!node.parentId) continue;
    const parent = ids.get(node.parentId);
    if (!parent) return false;
    if (Math.hypot(node.x - parent.x, node.y - parent.y) < MIN_BONE - 1e-6) return false;
    if (node.y < -1e-6) return false;
  }
  const root = ids.get("t0");
  if (!root || root.y < MIN_SPLIT - 1e-6) return false;
  const above = nodes.filter((node) => node.id !== "base" && node.id !== "t0");
  const top = above.reduce((max, node) => Math.max(max, node.y), 0);
  return top > root.y + 0.08;
}

/** Height, split, tip spacing, tip count, and whether any branch forks again. */
export function poseSummary(pose: SplitPose): { height: number; split: number; spacing: number; trunks: number; levels: 1 | 2 } | null {
  const root = pose.nodes.find((node) => node.id === "t0");
  const tips = poseTips(pose.nodes);
  if (!root || tips.length < 2) return null;
  const top = Math.max(root.y, ...pose.nodes.filter((node) => node.id !== "base").map((node) => node.y));
  const height = top > root.y + 0.05 ? top : root.y + 0.25;
  const xs = tips.map((tip) => tip.x).sort((a, b) => a - b);
  let gap = 0;
  for (let index = 1; index < xs.length; index += 1) gap += xs[index]! - xs[index - 1]!;
  const spacing = gap / (xs.length - 1);
  return {
    height: round(height),
    split: round(root.y),
    spacing: round(spacing > 0.05 ? spacing : 0.25),
    trunks: tips.length,
    levels: pose.nodes.some((node) => node.id.split(".").length >= 3) ? 2 : 1,
  };
}

/**
 * Move one joint. `subtree` carries every branch that grows from it,
 * which is how a whole limb is aimed. The crotch alone leaves the tips put.
 * Null when the trunks would cross through each other or leave the ground.
 */
export function movePoseJoint(pose: SplitPose, id: string, x: number, y: number, subtree: boolean): SplitPose | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const next = copy(pose);
  const node = next.nodes.find((row) => row.id === id);
  if (!node) return null;
  if (id === "base") {
    node.x = round(x);
    node.y = 0;
    return separated(next.nodes) ? next : null;
  }
  const dx = x - node.x;
  const dy = y - node.y;
  if (subtree) {
    const ids = poseDescendants(next.nodes, id);
    for (const row of next.nodes) {
      if (!ids.has(row.id)) continue;
      row.x = round(row.x + dx);
      row.y = round(Math.max(0, row.y + dy));
    }
  } else {
    node.x = round(x);
    node.y = round(Math.max(0, y));
  }
  return separated(next.nodes) ? next : null;
}

function childLength(parent: SplitPoseNode, node: SplitPoseNode): { ux: number; uy: number; px: number; py: number; len: number } {
  const dx = node.x - parent.x;
  const dy = node.y - parent.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  return { ux, uy, px: -uy, py: ux, len };
}

/**
 * The selected tip becomes a fork. Two new tips leave it, continuing the
 * way that branch was aimed and spreading apart, so one side can fork
 * without the other moving.
 */
export function forkPoseNode(pose: SplitPose, trunkId: string): SplitPose | null {
  const node = pose.nodes.find((row) => row.id === trunkId);
  if (!node || node.id === "base" || !node.parentId) return null;
  if (pose.nodes.some((row) => row.parentId === trunkId)) return null;
  if (poseTips(pose.nodes).length + 1 > 16) return null;
  const parent = pose.nodes.find((row) => row.id === node.parentId);
  if (!parent) return null;
  const { ux, uy, px, py, len } = childLength(parent, node);
  const reach = Math.max(MIN_BONE * 2, len * 0.62);
  const spread = Math.max(MIN_BONE * 2, len * 0.38);
  const next = copy(pose);
  next.nodes.push(
    {
      id: `${trunkId}.0`,
      parentId: trunkId,
      x: round(node.x + ux * reach - px * spread),
      y: round(Math.max(0, node.y + uy * reach - py * spread)),
    },
    {
      id: `${trunkId}.1`,
      parentId: trunkId,
      x: round(node.x + ux * reach + px * spread),
      y: round(Math.max(0, node.y + uy * reach + py * spread)),
    },
  );
  return separated(next.nodes) ? next : null;
}

/** Another branch from a fork that already has children, aimed to one side of them. */
export function addPoseBranch(pose: SplitPose, forkId: string): SplitPose | null {
  const fork = pose.nodes.find((node) => node.id === forkId);
  if (!fork || fork.id === "base") return null;
  const kids = pose.nodes.filter((node) => node.parentId === forkId);
  if (kids.length === 0) return forkPoseNode(pose, forkId);
  if (poseTips(pose.nodes).length + 1 > 16) return null;
  const parent = pose.nodes.find((node) => node.id === fork.parentId) ?? fork;
  const { ux, uy, px, py, len } = childLength(parent, fork);
  const reach = Math.max(MIN_BONE * 2, len * 0.7);
  const side = kids.length % 2 === 0 ? 1 : -1;
  const spread = Math.max(MIN_BONE * 3, len * 0.45) * (1 + Math.floor(kids.length / 2) * 0.35);
  const index = kids.length;
  const next = copy(pose);
  next.nodes.push({
    id: `${forkId}.${index}`,
    parentId: forkId,
    x: round(fork.x + ux * reach + px * spread * side),
    y: round(Math.max(0, fork.y + uy * reach + py * spread * side)),
  });
  return separated(next.nodes) ? next : null;
}

/** Scale every height so the highest joint lands on `height`. */
export function scalePoseHeight(pose: SplitPose, height: number): SplitPose | null {
  const summary = poseSummary(pose);
  if (!summary || !(height > summary.split + 0.05)) return null;
  const factor = height / summary.height;
  const next = copy(pose);
  for (const node of next.nodes) if (node.id !== "base") node.y = round(node.y * factor);
  return separated(next.nodes) ? next : null;
}

/** Scale the spread so neighbouring tips average `spacing` apart. */
export function scalePoseSpacing(pose: SplitPose, spacing: number): SplitPose | null {
  const summary = poseSummary(pose);
  if (!summary || !(spacing > 0.05)) return null;
  const factor = spacing / summary.spacing;
  const next = copy(pose);
  for (const node of next.nodes) node.x = round(node.x * factor);
  return separated(next.nodes) ? next : null;
}

/** Move the main crotch up or down and leave the tips where they are. */
export function setPoseSplit(pose: SplitPose, split: number): SplitPose | null {
  const root = pose.nodes.find((node) => node.id === "t0");
  if (!root) return null;
  return movePoseJoint(pose, "t0", root.x, split, false);
}
