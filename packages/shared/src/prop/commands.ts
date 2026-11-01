/**
 * Trace edits as pure layout transforms. Each one returns an inverse that
 * puts the drawing back, so undo is applying that inverse. A drag is not a
 * command: the editor commits it once, when the pointer lifts.
 */

import {
  continueToCorner,
  continueToPoint,
  ensureStrings,
  stringById,
  stringEndId,
  type LayoutCorner,
  type LayoutEdge,
  type LayoutString,
  type PropLayout,
  type RunKind,
} from "./layout.ts";

export type MergeNotice = {
  stringIndex: number;
  firstOrder: number;
  secondOrder: number;
  /** The merged run is lit when either run was lit. */
  lit: boolean;
};

export type CommandRefusal = "wire-in" | "shared";

export type LayoutCommand =
  | { type: "addPoint"; stringId: string; x: number; y: number; kind: "lit" | "wire" }
  | { type: "joinPoint"; stringId: string; cornerId: string; kind: "lit" | "wire" }
  | { type: "removePoint"; cornerId: string; stringId?: string }
  | { type: "setRunDark"; edgeId: string; dark: boolean }
  | { type: "dropRun"; stringId: string; retire: boolean }
  | { type: "restoreRun"; stringId: string; edge: LayoutEdge; corner: LayoutCorner | null }
  | {
    type: "unmerge";
    stringId: string;
    corner: LayoutCorner;
    first: LayoutEdge;
    second: LayoutEdge;
    /** Ids the merge retired. Restoring takes them off the retired list. */
    retired: string[];
  }
  | { type: "replaceEdge"; edge: LayoutEdge; retiredAdd: string[]; retiredDrop: string[] };

export type AppliedCommand = {
  layout: PropLayout;
  /** Null when the command changed nothing. */
  inverse: LayoutCommand | null;
  merge: MergeNotice | null;
  refused: CommandRefusal | null;
};

export function applyCommand(layout: PropLayout, command: LayoutCommand): AppliedCommand {
  switch (command.type) {
    case "addPoint":
      return addPoint(layout, command);
    case "joinPoint":
      return joinPoint(layout, command);
    case "removePoint":
      return removePoint(layout, command);
    case "setRunDark":
      return setRunDark(layout, command);
    case "dropRun":
      return dropRun(layout, command);
    case "restoreRun":
      return restoreRun(layout, command);
    case "unmerge":
      return unmerge(layout, command);
    case "replaceEdge":
      return replaceEdge(layout, command);
    default: {
      const _never: never = command;
      return _never;
    }
  }
}

function addPoint(layout: PropLayout, command: Extract<LayoutCommand, { type: "addPoint" }>): AppliedCommand {
  const base = ensureStrings(layout);
  const string = stringById(base, command.stringId);
  if (string.id !== command.stringId) return unchanged(base);
  const before = string.run.length;
  const next = continueToPoint(base, command.stringId, command.x, command.y, command.kind);
  if (stringById(next, command.stringId).run.length === before) return unchanged(base);
  return done(next, { type: "dropRun", stringId: command.stringId, retire: false });
}

function joinPoint(layout: PropLayout, command: Extract<LayoutCommand, { type: "joinPoint" }>): AppliedCommand {
  const base = ensureStrings(layout);
  const string = stringById(base, command.stringId);
  if (string.id !== command.stringId) return unchanged(base);
  const before = string.run.length;
  const next = continueToCorner(base, command.stringId, command.cornerId, command.kind);
  if (stringById(next, command.stringId).run.length === before) return unchanged(base);
  return done(next, { type: "dropRun", stringId: command.stringId, retire: false });
}

function removePoint(layout: PropLayout, command: Extract<LayoutCommand, { type: "removePoint" }>): AppliedCommand {
  const base = ensureStrings(layout);
  const strings = base.strings ?? [];
  const wireIn = strings.some((string) => string.startId === command.cornerId);
  const onlyPoint = base.corners.length === 1 && strings.every((string) => string.run.length === 0);
  if (wireIn && onlyPoint) return unchanged(base);
  if (wireIn) return refused(base, "wire-in");
  const between = findBetween(base, command.cornerId);
  if (between) return usesOf(base, command.cornerId) === 2 ? mergeRuns(base, between) : refused(base, "shared");
  const tail = findTail(base, command.cornerId, command.stringId);
  if (tail) return dropRun(base, { type: "dropRun", stringId: tail, retire: true });
  return refused(base, "shared");
}

function setRunDark(layout: PropLayout, command: Extract<LayoutCommand, { type: "setRunDark" }>): AppliedCommand {
  const base = ensureStrings(layout);
  const found = findEdge(base, command.edgeId);
  if (!found || found.edge.kind === "hidden") return unchanged(base);
  const want: RunKind = command.dark ? "wire" : "lit";
  if (found.edge.kind === want) return unchanged(base);
  const previous = found.edge;
  const lights = previous.lights ?? [];
  const nextEdge: LayoutEdge = command.dark ? stripDark(previous) : { ...previous, kind: "lit" };
  const retiredAdd = command.dark ? lights.map((light) => light.id) : [];
  const strings = mapRun(base, command.edgeId, () => nextEdge);
  const next = commitStrings(base, strings, base.corners, mergeRetired(base.retiredIds, retiredAdd, []));
  return done(next, { type: "replaceEdge", edge: previous, retiredAdd: [], retiredDrop: retiredAdd });
}

function dropRun(layout: PropLayout, command: Extract<LayoutCommand, { type: "dropRun" }>): AppliedCommand {
  const base = ensureStrings(layout);
  const string = (base.strings ?? []).find((row) => row.id === command.stringId);
  const edge = string?.run[string.run.length - 1];
  if (!string || !edge) return unchanged(base);
  const strings = (base.strings ?? []).map((row) => (
    row.id === string.id ? { ...row, run: row.run.slice(0, -1) } : row
  ));
  const used = cornerUse(strings);
  const corner = base.corners.find((row) => row.id === edge.to) ?? null;
  const dropCorner = corner != null && !used.has(corner.id);
  const corners = dropCorner ? base.corners.filter((row) => row.id !== corner.id) : base.corners;
  const retiredAdd = command.retire
    ? [edge.id, ...(dropCorner && corner ? [corner.id] : []), ...(edge.lights ?? []).map((light) => light.id)]
    : [];
  const next = commitStrings(base, strings, corners, mergeRetired(base.retiredIds, retiredAdd, []));
  return done(next, {
    type: "restoreRun",
    stringId: string.id,
    edge,
    corner: dropCorner ? corner : null,
  });
}

function restoreRun(layout: PropLayout, command: Extract<LayoutCommand, { type: "restoreRun" }>): AppliedCommand {
  const base = ensureStrings(layout);
  if (!(base.strings ?? []).some((string) => string.id === command.stringId)) return unchanged(base);
  const corners = command.corner && !base.corners.some((corner) => corner.id === command.corner!.id)
    ? [...base.corners, command.corner]
    : base.corners;
  const strings = (base.strings ?? []).map((string) => (
    string.id === command.stringId ? { ...string, run: [...string.run, command.edge] } : string
  ));
  const drop = [command.edge.id, command.corner?.id, ...(command.edge.lights ?? []).map((light) => light.id)]
    .filter((id): id is string => Boolean(id));
  const next = commitStrings(base, strings, corners, mergeRetired(base.retiredIds, [], drop));
  return done(next, { type: "dropRun", stringId: command.stringId, retire: true });
}

function unmerge(layout: PropLayout, command: Extract<LayoutCommand, { type: "unmerge" }>): AppliedCommand {
  const base = ensureStrings(layout);
  const corners = base.corners.some((corner) => corner.id === command.corner.id)
    ? base.corners
    : [...base.corners, command.corner];
  let replaced = false;
  const strings = (base.strings ?? []).map((string) => {
    if (string.id !== command.stringId) return string;
    const index = string.run.findIndex((edge) => edge.id === command.first.id);
    if (index < 0) return string;
    replaced = true;
    return {
      ...string,
      run: [...string.run.slice(0, index), command.first, command.second, ...string.run.slice(index + 1)],
    };
  });
  if (!replaced) return unchanged(base);
  const next = commitStrings(base, strings, corners, mergeRetired(base.retiredIds, [], command.retired));
  return done(next, { type: "removePoint", cornerId: command.corner.id, stringId: command.stringId });
}

function replaceEdge(layout: PropLayout, command: Extract<LayoutCommand, { type: "replaceEdge" }>): AppliedCommand {
  const base = ensureStrings(layout);
  const found = findEdge(base, command.edge.id);
  if (!found) return unchanged(base);
  const strings = mapRun(base, command.edge.id, () => command.edge);
  const next = commitStrings(base, strings, base.corners, mergeRetired(base.retiredIds, command.retiredAdd, command.retiredDrop));
  const retiredAdd = command.retiredDrop;
  const retiredDrop = command.retiredAdd;
  return done(next, { type: "replaceEdge", edge: found.edge, retiredAdd, retiredDrop });
}

function mergeRuns(layout: PropLayout, found: Between): AppliedCommand {
  const { string, index, first, second } = found;
  const from = layout.corners.find((corner) => corner.id === first.from);
  const to = layout.corners.find((corner) => corner.id === second.to);
  if (!from || !to) return refused(layout, "shared");
  const kind: RunKind = first.kind === "lit" || second.kind === "lit"
    ? "lit"
    : first.kind === "hidden" || second.kind === "hidden"
      ? "hidden"
      : "wire";
  const merged: LayoutEdge = {
    id: first.id,
    from: first.from,
    to: second.to,
    kind,
    ...(first.name ? { name: first.name } : {}),
  };
  const strings = (layout.strings ?? []).map((row) => (
    row.id === string.id
      ? { ...row, run: [...row.run.slice(0, index), merged, ...row.run.slice(index + 2)] }
      : row
  ));
  const used = cornerUse(strings);
  const corner = layout.corners.find((row) => row.id === second.from) ?? null;
  if (!corner) return refused(layout, "shared");
  const corners = used.has(corner.id) ? layout.corners : layout.corners.filter((row) => row.id !== corner.id);
  const retired = [
    second.id,
    ...(used.has(corner.id) ? [] : [corner.id]),
    ...(first.lights ?? []).map((light) => light.id),
    ...(second.lights ?? []).map((light) => light.id),
  ];
  const next = commitStrings(layout, strings, corners, mergeRetired(layout.retiredIds, retired, []));
  const stringIndex = (layout.strings ?? []).findIndex((row) => row.id === string.id);
  return {
    layout: next,
    inverse: {
      type: "unmerge",
      stringId: string.id,
      corner,
      first,
      second,
      retired,
    },
    merge: {
      stringIndex: Math.max(0, stringIndex),
      firstOrder: index + 1,
      secondOrder: index + 2,
      lit: kind === "lit",
    },
    refused: null,
  };
}

type Between = { string: LayoutString; index: number; first: LayoutEdge; second: LayoutEdge };

function findBetween(layout: PropLayout, cornerId: string): Between | null {
  let found: Between | null = null;
  for (const string of layout.strings ?? []) {
    const index = string.run.findIndex((edge, place) => edge.to === cornerId && string.run[place + 1]?.from === cornerId);
    if (index < 0) continue;
    if (found) return null;
    const first = string.run[index]!;
    const second = string.run[index + 1]!;
    found = { string, index, first, second };
  }
  return found;
}

function findTail(layout: PropLayout, cornerId: string, prefer?: string): string | null {
  const strings = layout.strings ?? [];
  const ends = strings.filter((string) => string.run.length > 0 && stringEndId(string) === cornerId);
  const picked = ends.find((string) => string.id === prefer) ?? ends[0];
  return picked?.id ?? null;
}

function findEdge(layout: PropLayout, edgeId: string): { edge: LayoutEdge } | null {
  for (const string of layout.strings ?? []) {
    const edge = string.run.find((row) => row.id === edgeId);
    if (edge) return { edge };
  }
  return null;
}

function stripDark(edge: LayoutEdge): LayoutEdge {
  const {
    lockedLights: _lights,
    manualLights: _manual,
    lights: _placed,
    lockedLengthM: _length,
    ...rest
  } = edge;
  return { ...rest, kind: "wire" };
}

function mapRun(layout: PropLayout, edgeId: string, fn: (edge: LayoutEdge) => LayoutEdge): LayoutString[] {
  return (layout.strings ?? []).map((string) => ({
    ...string,
    run: string.run.map((edge) => (edge.id === edgeId ? fn(edge) : edge)),
  }));
}

function usesOf(layout: PropLayout, cornerId: string): number {
  let uses = 0;
  for (const string of layout.strings ?? []) {
    for (const edge of string.run) {
      if (edge.from === cornerId) uses += 1;
      if (edge.to === cornerId) uses += 1;
    }
  }
  return uses;
}

function cornerUse(strings: readonly LayoutString[]): Set<string> {
  const used = new Set<string>();
  for (const string of strings) {
    used.add(string.startId);
    for (const edge of string.run) {
      used.add(edge.from);
      used.add(edge.to);
    }
  }
  return used;
}

function mergeRetired(existing: readonly string[] | undefined, add: readonly string[], drop: readonly string[]): string[] | undefined {
  const gone = new Set(drop);
  const ids = [...(existing ?? []).filter((id) => !gone.has(id)), ...add.filter((id) => !gone.has(id))];
  const unique = [...new Set(ids)];
  return unique.length > 0 ? unique : existing?.length ? [] : undefined;
}

function commitStrings(
  layout: PropLayout,
  strings: LayoutString[],
  corners: LayoutCorner[],
  retiredIds: string[] | undefined,
): PropLayout {
  const next: PropLayout = { ...layout, corners, strings, run: strings[0]?.run ?? [] };
  if (retiredIds == null) {
    if (!layout.retiredIds) {
      const { retiredIds: _omit, ...rest } = next;
      return rest;
    }
    return next;
  }
  if (retiredIds.length === 0) {
    const { retiredIds: _omit, ...rest } = next;
    return rest;
  }
  return { ...next, retiredIds };
}

function done(layout: PropLayout, inverse: LayoutCommand): AppliedCommand {
  return { layout, inverse, merge: null, refused: null };
}

function unchanged(layout: PropLayout): AppliedCommand {
  return { layout, inverse: null, merge: null, refused: null };
}

function refused(layout: PropLayout, reason: CommandRefusal): AppliedCommand {
  return { layout, inverse: null, merge: null, refused: reason };
}
