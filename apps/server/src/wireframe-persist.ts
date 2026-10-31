import {
  compileWireframe,
  formatLedmapJson,
  ledmapsMatch,
  parseLedmapJson,
  parseWireframeSpec,
  segmentsForWireframeProp,
  wireframeRefuseReason,
  type CompiledWireframe,
  type Element,
  type HostPort,
  type Light,
  type Prop,
  type WireframeSpec,
} from "@nightplot/shared";
import type { FileLightsStore } from "./store/lights-store.ts";
import type { ReadWledLedmap, WriteWledLedmap } from "./wled/native-backup.ts";

export type PersistWireframeResult =
  | { ok: true; prop: Prop; elements: Element[]; compiled: CompiledWireframe }
  | { ok: false; message: string };

export type LedmapWriteResult =
  | { ok: true; digest: string | null }
  | { ok: false; status: 409 | 422 | 503; error: string; message: string };

export function persistWireframeOnLight(input: {
  store: FileLightsStore;
  light: Light;
  propId: string;
  label: string;
  spec: WireframeSpec;
  palette: readonly { hex: string }[];
}): PersistWireframeResult {
  const refuse = wireframeRefuseReason(input.spec, input.light.ledCount);
  if (refuse) return { ok: false, message: refuse };
  const existingProps = input.store.propsFor(input.light.id);
  const otherWireframe = existingProps.find((row) => row.kind === "wireframe" && row.id !== input.propId);
  if (otherWireframe) {
    return { ok: false, message: "This Light already has a wireframe Prop. Correct that one. A second map was not saved." };
  }
  const existingProp = existingProps.find((row) => row.id === input.propId);
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
  };
  input.store.replaceElements(input.light.id, created);
  input.store.replaceProps(
    input.light.id,
    existingProp
      ? existingProps.map((row) => (row.id === input.propId ? prop : row))
      : [...existingProps, prop],
  );
  return { ok: true, prop, elements: created, compiled };
}

export function specFromBody(value: unknown, fallback?: WireframeSpec | null): WireframeSpec | null {
  if (value === undefined) return fallback ?? null;
  return parseWireframeSpec(value);
}

export async function writeAndVerifyLedmap(input: {
  light: Light;
  props: readonly Prop[];
  readLedmap: ReadWledLedmap;
  writeLedmap: WriteWledLedmap;
}): Promise<LedmapWriteResult> {
  const prop = input.props.find((row) => row.kind === "wireframe" && row.wireframe);
  if (!prop?.wireframe) return { ok: true, digest: null };
  const refuse = wireframeRefuseReason(prop.wireframe, input.light.ledCount);
  if (refuse) return { ok: false, status: 422, error: "invalid-wireframe", message: refuse };
  const compiled = compileWireframe(prop.wireframe, input.light.ledCount);
  const dest: HostPort = { hostname: input.light.hostname, port: input.light.port };
  try {
    await input.writeLedmap(dest, formatLedmapJson(compiled.ledmap));
  } catch (error) {
    return {
      ok: false,
      status: 503,
      error: "ledmap-failed",
      message: `WLED did not take ledmap.json. ${error instanceof Error ? error.message : ""} Nothing else was sent.`.trim(),
    };
  }
  let liveRaw: string | null;
  try {
    liveRaw = await input.readLedmap(dest);
  } catch {
    return {
      ok: false,
      status: 409,
      error: "ledmap-reread-failed",
      message: "Wrote ledmap.json, but it did not reread. Not treating as success.",
    };
  }
  const matched = ledmapsMatch(compiled.ledmap, liveRaw === null ? null : parseLedmapJson(liveRaw));
  if (matched === null) {
    return {
      ok: false,
      status: 409,
      error: "ledmap-reread-unknown",
      message: "Wrote ledmap.json, but the controller map was not a map. Not treating as success.",
    };
  }
  if (!matched) {
    return {
      ok: false,
      status: 409,
      error: "ledmap-mismatch",
      message: "Wrote ledmap.json, but the reread differs. Not treating as success.",
    };
  }
  return { ok: true, digest: compiled.ledmapDigest };
}
