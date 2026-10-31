/**
 * Controller → outputs → Segments. A missing `outputs` row is a single-strip
 * Light from before fleet setup — not an empty controller.
 */

import type { Light, LightOutput, Element } from "./lights.ts";
import type { DraftRange, RangeIssue } from "./range.ts";
import { rangeLabel, validateDeclaredRanges } from "./range.ts";
import { isProvisionLedType, type ProvisionRead } from "./provision.ts";

export function legacyOutputId(lightId: string): string {
  return `${lightId}:out:0`;
}

export function isLightOutput(value: unknown): value is LightOutput {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<LightOutput>;
  return (
    typeof row.id === "string" &&
    row.id.length > 0 &&
    Number.isInteger(row.index) &&
    (row.index ?? -1) >= 0 &&
    Number.isInteger(row.start) &&
    (row.start ?? -1) >= 0 &&
    Number.isInteger(row.ledCount) &&
    (row.ledCount ?? 0) > 0 &&
    typeof row.stripKind === "string" &&
    (row.gpio === null || Number.isInteger(row.gpio)) &&
    (row.nativeType === null || Number.isInteger(row.nativeType)) &&
    (row.nativeOrder === null || Number.isInteger(row.nativeOrder)) &&
    (row.colorOrder === null || typeof row.colorOrder === "string")
  );
}

export function migrateLightOutputs(light: Pick<Light, "id" | "ledCount" | "stripKind" | "outputs">): LightOutput[] {
  const listed = light.outputs;
  if (Array.isArray(listed) && listed.length > 0 && listed.every(isLightOutput)) {
    return listed;
  }
  return [
    {
      id: legacyOutputId(light.id),
      index: 0,
      start: 0,
      ledCount: light.ledCount,
      stripKind: light.stripKind,
      gpio: null,
      nativeType: null,
      nativeOrder: null,
      colorOrder: null,
    },
  ];
}

export function withMigratedOutputs<T extends Light>(light: T): T {
  return { ...light, outputs: migrateLightOutputs(light) };
}

export function outputCaption(output: Pick<LightOutput, "index">): string {
  return `Output ${output.index + 1}`;
}

export function outputIdAt(index: number, outputs: LightOutput[]): string | undefined {
  return outputs.find((output) => index >= output.start && index < output.start + output.ledCount)?.id;
}

export function elementOutputId(
  element: Pick<Element, "lightId" | "outputId">,
  outputs: LightOutput[],
): string {
  if (element.outputId && outputs.some((output) => output.id === element.outputId)) {
    return element.outputId;
  }
  return outputs[0]?.id ?? legacyOutputId(element.lightId);
}

export function outputsFromProvision(light: Light, provision: ProvisionRead): LightOutput[] {
  if (provision.outputs.length === 0) return migrateLightOutputs(light);
  const existing = light.outputs ?? [];
  return provision.outputs.map((bus) => {
    const prev = existing.find((output) => output.index === bus.index);
    const ledType = bus.settings.ledType;
    const stripKind = isProvisionLedType(ledType)
      ? ledType
      : (prev?.stripKind ?? light.stripKind);
    const ledCount = bus.settings.length ?? prev?.ledCount ?? 0;
    return {
      id: prev?.id ?? (bus.index === 0 ? legacyOutputId(light.id) : `${light.id}:out:${bus.index}`),
      index: bus.index,
      start: bus.start ?? prev?.start ?? 0,
      ledCount: ledCount > 0 ? ledCount : prev?.ledCount ?? light.ledCount,
      stripKind,
      gpio: bus.settings.gpio,
      nativeType: bus.settings.nativeType,
      nativeOrder: bus.settings.nativeOrder,
      colorOrder: bus.settings.colorOrder,
    };
  });
}

/**
 * Segments stay in the controller’s combined LED index space. A set `outputId`
 * must name a known output and the range must sit on that output.
 */
export function validateOutputBounds(
  drafts: DraftRange[],
  outputs: LightOutput[],
): RangeIssue[] {
  if (outputs.length === 0) return [];
  const issues: RangeIssue[] = [];
  for (const draft of drafts) {
    if (!draft.outputId) continue;
    const output = outputs.find((row) => row.id === draft.outputId);
    if (!output) {
      issues.push({
        code: "over-ledCount",
        elementId: draft.id,
        start: draft.start,
        stop: draft.stop,
        message: `${rangeLabel(draft)} names an output that is not on this Light.`,
      });
      continue;
    }
    const spanStart = output.start;
    const spanStop = output.start + output.ledCount;
    if (draft.start < spanStart || draft.stop > spanStop || draft.start < 0 || draft.stop < 0) {
      issues.push({
        code: "over-ledCount",
        elementId: draft.id,
        start: draft.start,
        stop: draft.stop,
        message: `${rangeLabel(draft)} ${draft.start}–${draft.stop} is not on output ${output.index + 1} (LEDs ${spanStart}–${spanStop}).`,
      });
    }
  }
  return issues;
}

export function validateDeclaredRangesForLight(
  drafts: DraftRange[],
  light: Pick<Light, "ledCount" | "outputs">,
): RangeIssue[] {
  const outputs = light.outputs?.length ? light.outputs : [];
  return [...validateDeclaredRanges(drafts, light.ledCount), ...validateOutputBounds(drafts, outputs)];
}
