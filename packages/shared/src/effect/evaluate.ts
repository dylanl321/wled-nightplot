import { channelByte, evaluateEffectExpr, parseEffectExpr } from "./expr.ts";
import {
  EFFECT_BUILTINS,
  EFFECT_CONTRACT_VERSION,
  EFFECT_FUNCTIONS,
  EFFECT_NODE_COUNT_MAX,
  EFFECT_NODE_COUNT_MIN,
  type EffectBinding,
  type EffectChannels,
  type EffectDefinition,
  type EffectDeployment,
  type EffectEnv,
  type EffectFrame,
  type EffectParameter,
  type EffectPixel,
} from "./types.ts";

export {
  EFFECT_BUILTINS,
  EFFECT_CONTRACT_VERSION,
  EFFECT_FUNCTIONS,
  EFFECT_NODE_COUNT_MAX,
  EFFECT_NODE_COUNT_MIN,
} from "./types.ts";
export type {
  EffectBinding,
  EffectChannels,
  EffectDefinition,
  EffectDeployment,
  EffectEnv,
  EffectExpr,
  EffectFrame,
  EffectParameter,
  EffectPixel,
} from "./types.ts";
export { parseEffectExpr, evaluateEffectExpr } from "./expr.ts";

const RESERVED = new Set<string>([...EFFECT_BUILTINS, ...EFFECT_FUNCTIONS]);
const PARAM_ID = /^[a-z][a-z0-9_]{0,31}$/;
const PARAM_MAX = 16;

function isEntityId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 64 && value.trim() === value;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseParameter(value: unknown): EffectParameter | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<EffectParameter>;
  if (typeof row.id !== "string" || !PARAM_ID.test(row.id) || RESERVED.has(row.id)) return null;
  if (typeof row.label !== "string" || !row.label.trim() || row.label.length > 40) return null;
  if (row.kind !== "number" || !isFiniteNumber(row.min) || !isFiniteNumber(row.max) ||
    !isFiniteNumber(row.default) || row.min > row.max || row.default < row.min || row.default > row.max) {
    return null;
  }
  return { id: row.id, label: row.label.trim(), kind: "number", min: row.min, max: row.max, default: row.default };
}

export function effectAllowedVars(parameters: readonly EffectParameter[]): Set<string> {
  return new Set<string>([...EFFECT_BUILTINS, ...parameters.map((parameter) => parameter.id)]);
}

function parseChannels(value: unknown, allowed: ReadonlySet<string>): EffectChannels | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<EffectChannels>;
  if (typeof row.r !== "string" || typeof row.g !== "string" || typeof row.b !== "string") return null;
  if (!parseEffectExpr(row.r, allowed) || !parseEffectExpr(row.g, allowed) || !parseEffectExpr(row.b, allowed)) {
    return null;
  }
  if (row.w === undefined) return { r: row.r, g: row.g, b: row.b };
  if (typeof row.w !== "string" || !parseEffectExpr(row.w, allowed)) return null;
  return { r: row.r, g: row.g, b: row.b, w: row.w };
}

export function parseEffectDefinition(value: unknown): EffectDefinition | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<EffectDefinition>;
  if (row.version !== EFFECT_CONTRACT_VERSION || !isEntityId(row.id) ||
    typeof row.name !== "string" || !row.name.trim() || row.name.length > 80 ||
    !Array.isArray(row.parameters) || row.parameters.length > PARAM_MAX ||
    "nodeCount" in row || "pixels" in row) return null;
  const parameters: EffectParameter[] = [];
  const seen = new Set<string>();
  for (const item of row.parameters) {
    const parameter = parseParameter(item);
    if (!parameter || seen.has(parameter.id)) return null;
    seen.add(parameter.id);
    parameters.push(parameter);
  }
  const channels = parseChannels(row.channels, effectAllowedVars(parameters));
  if (!channels) return null;
  return { version: EFFECT_CONTRACT_VERSION, id: row.id, name: row.name.trim(), parameters, channels };
}

function parseValues(value: unknown): Record<string, number> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: Record<string, number> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!PARAM_ID.test(key) || !isFiniteNumber(item)) return null;
    out[key] = item;
  }
  return out;
}

export function parseEffectBinding(value: unknown): EffectBinding | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<EffectBinding>;
  const values = parseValues(row.values);
  if (!isEntityId(row.id) || !isEntityId(row.definitionId) || !isEntityId(row.lightId) ||
    !(row.segmentId === null || isEntityId(row.segmentId)) || !values) return null;
  return {
    id: row.id,
    definitionId: row.definitionId,
    lightId: row.lightId,
    segmentId: row.segmentId,
    values,
  };
}

export function parseEffectDeployment(value: unknown): EffectDeployment | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<EffectDeployment>;
  const nodeCount = row.nodeCount;
  if (!isEntityId(row.id) || !isEntityId(row.bindingId) || typeof nodeCount !== "number" ||
    !Number.isInteger(nodeCount) || nodeCount < EFFECT_NODE_COUNT_MIN ||
    nodeCount > EFFECT_NODE_COUNT_MAX) return null;
  return { id: row.id, bindingId: row.bindingId, nodeCount };
}

export function mergeEffectValues(
  definition: EffectDefinition,
  values: Record<string, number> | undefined,
): Record<string, number> | null {
  const merged: Record<string, number> = {};
  for (const parameter of definition.parameters) merged[parameter.id] = parameter.default;
  if (!values) return merged;
  for (const [key, item] of Object.entries(values)) {
    const parameter = definition.parameters.find((entry) => entry.id === key);
    if (!parameter || !isFiniteNumber(item) || item < parameter.min || item > parameter.max) return null;
    merged[key] = item;
  }
  return merged;
}

export function normalizedPosition(index: number, nodeCount: number): number | null {
  if (!Number.isInteger(index) || !Number.isInteger(nodeCount) ||
    nodeCount < EFFECT_NODE_COUNT_MIN || nodeCount > EFFECT_NODE_COUNT_MAX ||
    index < 0 || index >= nodeCount) return null;
  return nodeCount === 1 ? 0 : index / (nodeCount - 1);
}

function compileChannels(definition: EffectDefinition) {
  const allowed = effectAllowedVars(definition.parameters);
  const r = parseEffectExpr(definition.channels.r, allowed);
  const g = parseEffectExpr(definition.channels.g, allowed);
  const b = parseEffectExpr(definition.channels.b, allowed);
  const w = definition.channels.w === undefined ? undefined : parseEffectExpr(definition.channels.w, allowed);
  if (!r || !g || !b || (definition.channels.w !== undefined && !w)) return null;
  return { r, g, b, w };
}

function pixelAt(
  compiled: NonNullable<ReturnType<typeof compileChannels>>,
  env: EffectEnv,
): EffectPixel {
  const pixel: EffectPixel = {
    r: channelByte(evaluateEffectExpr(compiled.r, env)),
    g: channelByte(evaluateEffectExpr(compiled.g, env)),
    b: channelByte(evaluateEffectExpr(compiled.b, env)),
  };
  if (compiled.w) pixel.w = channelByte(evaluateEffectExpr(compiled.w, env));
  return pixel;
}

/**
 * Sample one Effect across `nodeCount` nodes. The definition is not rewritten.
 * A software frame is not Preview, not Apply, and not a lit strip.
 */
export function sampleEffect(input: {
  definition: unknown;
  nodeCount: number;
  timeSec: number;
  values?: Record<string, number>;
}): EffectFrame | null {
  const definition = parseEffectDefinition(input.definition);
  if (!definition || !Number.isInteger(input.nodeCount) ||
    input.nodeCount < EFFECT_NODE_COUNT_MIN || input.nodeCount > EFFECT_NODE_COUNT_MAX ||
    !isFiniteNumber(input.timeSec)) return null;
  const values = mergeEffectValues(definition, input.values);
  const compiled = compileChannels(definition);
  if (!values || !compiled) return null;
  const pixels: EffectPixel[] = [];
  for (let index = 0; index < input.nodeCount; index += 1) {
    const u = normalizedPosition(index, input.nodeCount);
    if (u === null) return null;
    pixels.push(pixelAt(compiled, { u, t: input.timeSec, i: index, n: input.nodeCount, values }));
  }
  return { nodeCount: input.nodeCount, timeSec: input.timeSec, pixels };
}

/** Evaluate the same source at one normalized position. Used to prove resample. */
export function sampleEffectAt(input: {
  definition: unknown;
  u: number;
  timeSec: number;
  values?: Record<string, number>;
  index?: number;
  nodeCount?: number;
}): EffectPixel | null {
  const definition = parseEffectDefinition(input.definition);
  if (!definition || !isFiniteNumber(input.u) || !isFiniteNumber(input.timeSec)) return null;
  const values = mergeEffectValues(definition, input.values);
  const compiled = compileChannels(definition);
  if (!values || !compiled) return null;
  return pixelAt(compiled, {
    u: input.u,
    t: input.timeSec,
    i: input.index,
    n: input.nodeCount,
    values,
  });
}

export function sampleBoundEffect(input: {
  definition: unknown;
  binding: unknown;
  deployment: unknown;
  timeSec: number;
}): EffectFrame | null {
  const definition = parseEffectDefinition(input.definition);
  const binding = parseEffectBinding(input.binding);
  const deployment = parseEffectDeployment(input.deployment);
  if (!definition || !binding || !deployment) return null;
  if (binding.definitionId !== definition.id || deployment.bindingId !== binding.id) return null;
  return sampleEffect({
    definition,
    nodeCount: deployment.nodeCount,
    timeSec: input.timeSec,
    values: binding.values,
  });
}
