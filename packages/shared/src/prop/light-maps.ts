/**
 * The motion maps one Light needs for the Looks library. This is the caller
 * the builder (`buildMotionMaps`) asks for: it works out where each Prop
 * really starts on the Light, follows "after another prop" chains, checks the
 * drawing against what was attached, and hands the builder each Look's
 * motions. Pure. It writes nothing; the server writes and rereads the maps.
 * Design: docs/hang-to-effects.md (slice 2).
 *
 * Any Prop with a drawing is mapped, whatever its kind and however it was
 * drawn (template, traced or custom), and several can share a Light. A well
 * house packs its face map as one block in the base map. A Prop with neither
 * drawing nor wireframe has no positions to sort by and keeps its place.
 */

import type { Element, Light } from "../lights.ts";
import { lookIncludesProp, resolveLookTarget, type Look, type LookMapPlan, type StringStart } from "../look.ts";
import { attachmentForLegacy, attachmentStringId, outputStartForAttachment, propStrings } from "./design.ts";
import { countLayout } from "./layout.ts";
import { buildMotionMaps, type MotionChoice, type MotionMapLookInput, type MotionMapProp, type MotionMapSlot } from "./motion-map.ts";
import type { Prop, PropAttachment } from "./types.ts";
import { wireframeRefuseReason } from "./wireframe.ts";

export type LightMapsPlan =
  | {
      ok: true;
      /** Null when no Prop on the Light has positions to map. Every Look then runs on map 0 in physical ranges. */
      plan: LookMapPlan | null;
      /** The `ledmapN.json` files to write, base map first. Empty when the only map is the plain wire order. */
      writes: MotionMapSlot[];
      /** Plain reasons a map differs from what was drawn or attached. */
      notes: string[];
    }
  | { ok: false; message: string; notes: string[]; wireframe: boolean };

function isIdentity(map: readonly number[]): boolean {
  return map.every((value, index) => value === index);
}

/** The motions a Look asks of these Props, as the map builder takes them. The push and the yard preview both read this. */
export function motionsFor(look: Look, props: readonly Prop[]): MotionMapLookInput {
  const motions: MotionChoice[] = [];
  const joined: string[] = [];
  for (const prop of props) {
    if (!lookIncludesProp(look, prop.id)) continue;
    const ownSections = look.overrides.some((row) => row.sectionId && row.propId === prop.id);
    const whole = resolveLookTarget(look, { start: 0, stop: 0, prop });
    if (!whole.off && whole.style.motion && whole.style.motion !== "wire") {
      motions.push({ propId: prop.id, motion: whole.style.motion });
    }
    if (!ownSections) {
      joined.push(prop.id);
      continue;
    }
    for (const section of prop.sections ?? []) {
      const resolved = resolveLookTarget(look, { start: 0, stop: 0, prop, sectionId: section.id });
      if (resolved.off) continue;
      motions.push({ propId: prop.id, sectionId: section.id, motion: resolved.style.motion ?? "wire" });
    }
  }
  return { id: look.id, motions, joined };
}

/**
 * Where each attached string of the Light's Props starts, in the Light's
 * combined light numbers. Strings whose start cannot be read are left out.
 * Looks use this to put each string's sections where it really sits.
 */
export function stringStartsFor(input: {
  light: Pick<Light, "id" | "outputs">;
  props: readonly Prop[];
  allProps?: readonly Prop[];
  elements: readonly Element[];
  attachments: readonly PropAttachment[];
}): StringStart[] {
  const allProps = input.allProps ?? input.props;
  const out: StringStart[] = [];
  for (const prop of input.props) {
    let list = input.attachments.filter((row) => row.propId === prop.id && row.lightId === input.light.id);
    let chain = input.attachments;
    if (list.length === 0) {
      const owns = input.elements.some((row) => prop.elementIds.includes(row.id));
      const legacy = owns ? attachmentForLegacy({ id: prop.id, lightId: input.light.id, elementIds: prop.elementIds }, input.elements, input.light) : null;
      if (!legacy) continue;
      list = [legacy];
      chain = [...input.attachments, legacy];
    }
    for (const attachment of list) {
      const onOutput = outputStartForAttachment({ attachment, props: allProps, attachments: chain });
      if (onOutput === null) continue;
      const base = input.light.outputs?.find((row) => row.id === attachment.outputId)?.start ?? 0;
      out.push({ propId: prop.id, stringId: attachmentStringId(attachment, prop), start: base + onOutput });
    }
  }
  return out;
}

export function planLightMaps(input: {
  light: Pick<Light, "id" | "ledCount" | "outputs">;
  /** The Props on this Light. */
  props: readonly Prop[];
  /** Every Prop, so an "after" chain can follow a Prop on another list. Defaults to `props`. */
  allProps?: readonly Prop[];
  elements: readonly Element[];
  attachments: readonly PropAttachment[];
  looks: readonly Look[];
}): LightMapsPlan {
  const notes: string[] = [];
  const allProps = input.allProps ?? input.props;
  const mapped: MotionMapProp[] = [];
  const drawn: Prop[] = [];
  const blocks: { propId: string; start: number; count: number }[] = [];
  let hasWireframe = false;

  /** The attachments of a Prop on this Light, one per string. A Prop saved before strings were attached one by one has a legacy first-string one, from its Segments. */
  const attachmentsOn = (prop: Prop): { list: PropAttachment[]; chain: readonly PropAttachment[] } => {
    const own = input.attachments.filter((row) => row.propId === prop.id && row.lightId === input.light.id);
    if (own.length > 0) return { list: own, chain: input.attachments };
    const owns = input.elements.some((row) => prop.elementIds.includes(row.id));
    const legacy = owns ? attachmentForLegacy({ id: prop.id, lightId: input.light.id, elementIds: prop.elementIds }, input.elements, input.light) : null;
    return legacy ? { list: [legacy], chain: [...input.attachments, legacy] } : { list: [], chain: input.attachments };
  };

  /** First light of one attached string on this Light. */
  const startOfString = (prop: Prop, attachment: PropAttachment, chain: readonly PropAttachment[]): { start: number } | { message: string } => {
    const onOutput = outputStartForAttachment({ attachment, props: allProps, attachments: chain });
    if (onOutput === null) return { message: `Nightplot cannot tell where ${prop.label} starts on this Light. Attach it again. Nothing was sent.` };
    return { start: (input.light.outputs?.find((row) => row.id === attachment.outputId)?.start ?? 0) + onOutput };
  };

  /** First light of a Prop (its first attached string) on this Light, from its attachment, else from its Segments. Null when it has neither. */
  const startOf = (prop: Prop): { start: number } | { message: string } | null => {
    const { list, chain } = attachmentsOn(prop);
    const first = list.find((row) => attachmentStringId(row, prop) === propStrings(prop)[0]?.id) ?? list[0];
    return first ? startOfString(prop, first, chain) : null;
  };

  for (const prop of input.props) {
    if (prop.wireframe) {
      hasWireframe = true;
      // A wireframe remaps the whole Light unless it was attached with its own count and start.
      const own = typeof prop.design?.ledCount === "number" ? startOf(prop) : null;
      if (own && "message" in own) return { ok: false, message: own.message, notes, wireframe: true };
      const count = own ? prop.design!.ledCount! : input.light.ledCount;
      const refuse = wireframeRefuseReason(prop.wireframe, count);
      if (refuse) return { ok: false, message: refuse, notes, wireframe: true };
      mapped.push({ prop, start: own ? own.start : 0, ledCount: count });
      continue;
    }
    if (!prop.layout) continue;
    const count = countLayout(prop.layout).total;
    if (count < 1) continue;
    const attached = prop.design?.ledCount;
    if (typeof attached === "number" && attached !== count) {
      return {
        ok: false,
        message: `${prop.label} is drawn with ${count} lights but attached with ${attached}. Attach it again so they agree. Nothing was sent.`,
        notes,
        wireframe: hasWireframe,
      };
    }
    const { list, chain } = attachmentsOn(prop);
    if (list.length === 0) continue;
    const strings = propStrings(prop);
    const attachedStrings: { stringId: string; start: number; count: number }[] = [];
    for (const string of strings) {
      const attachment = list.find((row) => attachmentStringId(row, prop) === string.id);
      if (!attachment) continue;
      const placed = startOfString(prop, attachment, chain);
      if ("message" in placed) return { ok: false, message: placed.message, notes, wireframe: hasWireframe };
      const stringCount = string.ledCount ?? 0;
      if (placed.start + stringCount > input.light.ledCount) {
        return {
          ok: false,
          message: `${prop.label}${strings.length > 1 ? `, string ${strings.indexOf(string) + 1},` : ""} needs lights ${placed.start + 1} to ${placed.start + stringCount} and this Light has ${input.light.ledCount}. Attach it again. Nothing was sent.`,
          notes,
          wireframe: hasWireframe,
        };
      }
      attachedStrings.push({ stringId: string.id, start: placed.start, count: stringCount });
    }
    if (attachedStrings.length === 0) continue;
    const all = attachedStrings.length === strings.length;
    if (!all) {
      const missing = strings.filter((string) => !attachedStrings.some((row) => row.stringId === string.id));
      notes.push(`${prop.label}: ${missing.length === 1 ? "one string is" : `${missing.length} strings are`} not attached, so ${missing.length === 1 ? "its" : "their"} lights are left out of the map.`);
    }
    const lowest = Math.min(...attachedStrings.map((row) => row.start));
    mapped.push({
      prop,
      start: lowest,
      ...(all ? { ledCount: count } : {}),
      ...(strings.length > 1 ? { strings: attachedStrings.map((row) => ({ stringId: row.stringId, start: row.start })) } : {}),
    });
    drawn.push(prop);
    // One block per run of neighbouring lights, so a gap between strings is never a segment.
    const spans = attachedStrings.filter((row) => row.count > 0).sort((x, y) => x.start - y.start);
    let from = -1;
    let to = -1;
    for (const span of spans) {
      if (from >= 0 && span.start === to) {
        to = span.start + span.count;
        continue;
      }
      if (from >= 0) blocks.push({ propId: prop.id, start: from, count: to - from });
      from = span.start;
      to = span.start + span.count;
    }
    if (from >= 0) blocks.push({ propId: prop.id, start: from, count: to - from });
  }

  if (mapped.length === 0) return { ok: true, plan: null, writes: [], notes };

  const built = buildMotionMaps({
    props: mapped,
    looks: input.looks.map((look) => motionsFor(look, drawn)),
    ledCount: input.light.ledCount,
  });
  notes.push(...built.notes);
  if (!built.ok) return { ok: false, message: `${built.message} Nothing was sent.`, notes, wireframe: hasWireframe };

  const base = built.maps[0]!;
  const needed = built.maps.length > 1 || !isIdentity(base.map);
  return {
    ok: true,
    plan: { result: built, blocks },
    writes: needed ? built.maps : [],
    notes,
  };
}
