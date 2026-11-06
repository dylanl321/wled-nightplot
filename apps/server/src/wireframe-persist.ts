import {
  compileWireframe,
  formatLedmapJson,
  planLightMaps,
  ledmapDigest,
  ledmapsMatch,
  mergeLastLedmap,
  normalizeLastLedmap,
  parseLedmapJson,
  parseWireframeSpec,
  segmentsForWireframeProp,
  wireframeRefuseReason,
  type CompiledWireframe,
  type Element,
  type HostPort,
  type LastLedmap,
  type Light,
  type LightMapsPlan,
  type Look,
  type Prop,
  type PropDesign,
  type WireframeSpec,
} from "@nightplot/shared";
import type { FileLightsStore } from "./store/lights-store.ts";
import { ledmapFileName, type ReadWledLedmap, type WriteWledLedmap } from "./wled/native-backup.ts";

export type PersistWireframeResult =
  | { ok: true; prop: Prop; elements: Element[]; compiled: CompiledWireframe }
  | { ok: false; message: string };

type LedmapRow = { slot: number; digest: string };

/**
 * `written` are files that reread as sent. On a failure, `observed` are files
 * whose reread was a different map (the digest is of what the controller
 * returned), and `unread` are slots Nightplot cannot vouch for any more (the
 * write failed or the reread gave nothing usable). The record follows all
 * three so it says what is on the controller, not what was meant.
 */
export type LedmapWriteResult =
  | { ok: true; written: LedmapRow[] }
  | {
      ok: false;
      status: 409 | 422 | 503;
      error: string;
      message: string;
      written: LedmapRow[];
      observed: LedmapRow[];
      unread: number[];
    };

/**
 * The `lastLedmap` list after a write attempt, or undefined when the attempt
 * changed nothing worth recording. Written files and files that reread as a
 * different map are recorded as found; slots that could not be read are
 * dropped from the record rather than left claiming the old map.
 */
export function ledmapRecordAfter(previous: unknown, result: LedmapWriteResult, at: string): LastLedmap[] | null | undefined {
  const found = [...result.written, ...(result.ok ? [] : result.observed)];
  const unread = result.ok ? [] : result.unread;
  if (found.length === 0 && unread.length === 0) return undefined;
  const kept = (normalizeLastLedmap(previous) ?? []).filter((row) => !unread.includes(row.slot));
  const next = mergeLastLedmap(kept, found.map((file) => ({ ...file, at })));
  return next.length > 0 ? next : null;
}

export function persistWireframeOnLight(input: {
  store: FileLightsStore;
  light: Light;
  propId: string;
  label: string;
  spec: WireframeSpec;
  design?: PropDesign;
  palette: readonly { hex: string }[];
}): PersistWireframeResult {
  const refuse = wireframeRefuseReason(input.spec, input.light.ledCount);
  if (refuse) return { ok: false, message: refuse };
  const existingProps = input.store.propsFor(input.light.id);
  const otherWireframe = existingProps.find((row) => row.kind === "wireframe" && row.id !== input.propId);
  if (otherWireframe) {
    return { ok: false, message: "This Light already has a wireframe Prop. Correct that one. A second map was not saved." };
  }
  const onLight = existingProps.find((row) => row.id === input.propId);
  const existingProp = onLight ?? input.store.loadProps().find((row) => row.id === input.propId);
  const existing = input.store.elementsFor(input.light.id);
  const others = existing.filter((element) => !existingProp?.elementIds.includes(element.id));
  if (others.length > 0) {
    return {
      ok: false,
      message: "A wireframe remaps this whole Light. Remove the other Segments first. Nothing was saved.",
    };
  }
  const compiled = compileWireframe(input.spec, input.light.ledCount);
  const drafts = segmentsForWireframeProp({
    propId: input.propId,
    label: input.label,
    compiled,
  });
  if (drafts.length === 0) {
    return { ok: false, message: "This wireframe has no faces to save. Draw or lock the path first." };
  }
  const created: Element[] = drafts.map((segment, index) => {
    const previous = existing.find((element) => element.id === segment.id);
    return {
      id: segment.id,
      lightId: input.light.id,
      label: segment.label,
      start: segment.start,
      stop: segment.stop,
      color: previous?.color ?? { hex: input.palette[index % input.palette.length]!.hex, white: 0 },
      ...(previous?.outputId ? { outputId: previous.outputId } : {}),
    };
  });
  const prop: Prop = {
    id: input.propId,
    lightId: input.light.id,
    label: input.label,
    kind: "wireframe",
    elementIds: created.map((element) => element.id),
    wireframe: input.spec,
    ...(input.design ?? existingProp?.design ? { design: input.design ?? existingProp?.design } : {}),
  };
  input.store.replaceElements(input.light.id, created);
  input.store.replaceProps(
    input.light.id,
    onLight
      ? existingProps.map((row) => (row.id === input.propId ? prop : row))
      : [...existingProps, prop],
  );
  return { ok: true, prop, elements: created, compiled };
}

export function specFromBody(value: unknown, fallback?: WireframeSpec | null): WireframeSpec | null {
  if (value === undefined) return fallback ?? null;
  return parseWireframeSpec(value);
}

/** One map file to put on a Light: the slot (0 is `ledmap.json`), its list and digest. */
export type LedmapFile = { slot: number; map: readonly number[]; digest: string };

/**
 * Write every map file, rereading and comparing each one. Stops at the first
 * file that fails to write, reread or match, and says which. A file that
 * does not reread the same is not success, and nothing after it is sent.
 * An empty list writes nothing.
 */
/** What a failed multi-file write says about files already put on the controller. */
function writtenSoFar(written: readonly { slot: number }[]): string {
  return written.length === 0
    ? "Nothing else was sent."
    : `Already written and left in place: ${written.map((file) => ledmapFileName(file.slot)).join(", ")}. No presets were sent.`;
}

export async function writeAndVerifyLedmap(input: {
  light: Light;
  maps: readonly LedmapFile[];
  readLedmap: ReadWledLedmap;
  writeLedmap: WriteWledLedmap;
}): Promise<LedmapWriteResult> {
  const dest: HostPort = { hostname: input.light.hostname, port: input.light.port };
  const written: { slot: number; digest: string }[] = [];
  for (const file of input.maps) {
    const name = ledmapFileName(file.slot);
    try {
      await input.writeLedmap(dest, formatLedmapJson(file.map), file.slot);
    } catch (error) {
      return {
        ok: false,
        status: 503,
        error: "ledmap-failed",
        message: `WLED did not take ${name}. ${error instanceof Error ? error.message : ""} ${writtenSoFar(written)}`.trim(),
        written,
        observed: [],
        unread: [file.slot],
      };
    }
    let liveRaw: string | null;
    try {
      liveRaw = await input.readLedmap(dest, file.slot);
    } catch {
      return {
        ok: false,
        status: 409,
        error: "ledmap-reread-failed",
        message: `Wrote ${name}, but it did not reread. Not treating as success. ${writtenSoFar(written)}`,
        written,
        observed: [],
        unread: [file.slot],
      };
    }
    const live = liveRaw === null ? null : parseLedmapJson(liveRaw);
    const matched = ledmapsMatch(file.map, live);
    if (matched === null) {
      return {
        ok: false,
        status: 409,
        error: "ledmap-reread-unknown",
        message: `Wrote ${name}, but the controller map was not a map. Not treating as success. ${writtenSoFar(written)}`,
        written,
        observed: [],
        unread: [file.slot],
      };
    }
    if (!matched) {
      return {
        ok: false,
        status: 409,
        error: "ledmap-mismatch",
        message: `Wrote ${name}, but the reread differs. Not treating as success. ${writtenSoFar(written)}`,
        written,
        observed: [{ slot: file.slot, digest: ledmapDigest(live!) }],
        unread: [],
      };
    }
    written.push({ slot: file.slot, digest: file.digest });
  }
  return { ok: true, written };
}

/**
 * A push that needs no map still names map 0 in every preset. If this Light
 * may hold a `ledmap.json` from an earlier push (the record says so, or the
 * controller returns one that is not a straight pass-through), return the
 * identity base map to write over it. Otherwise nothing.
 */
export async function staleBaseMapReset(input: {
  light: Light;
  readLedmap: ReadWledLedmap;
}): Promise<LedmapFile[]> {
  const identity = Array.from({ length: input.light.ledCount }, (_, index) => index);
  const reset = [{ slot: 0, map: identity, digest: ledmapDigest(identity) }];
  if (normalizeLastLedmap(input.light.lastLedmap)?.some((row) => row.slot === 0)) return reset;
  try {
    const raw = await input.readLedmap({ hostname: input.light.hostname, port: input.light.port }, 0);
    if (raw === null) return [];
    const live = parseLedmapJson(raw);
    return live !== null && ledmapsMatch(identity, live) === true ? [] : reset;
  } catch {
    return [];
  }
}

/**
 * The maps this Light needs for the Looks library (or just the base map with
 * no Looks), from its Props and where they are attached. A refusal is plain
 * and comes before anything is written.
 */
export function planLedmapsFor(
  store: Pick<FileLightsStore, "propsFor" | "loadProps" | "loadAttachments" | "elementsFor">,
  light: Light,
  looks: readonly Look[],
): LightMapsPlan {
  return planLightMaps({
    light,
    props: store.propsFor(light.id),
    allProps: store.loadProps(),
    elements: store.elementsFor(light.id),
    attachments: store.loadAttachments(),
    looks,
  });
}
