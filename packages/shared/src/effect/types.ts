/**
 * Portable Effect contract. Colour is a function of normalized position and
 * time — node count lives on the deployment, not in the source.
 * Grammar: docs/effects-research-and-plan.md
 */

export const EFFECT_CONTRACT_VERSION = 1 as const;
export const EFFECT_NODE_COUNT_MIN = 1;
export const EFFECT_NODE_COUNT_MAX = 4096;

export const EFFECT_BUILTINS = ["u", "t", "i", "n", "pi", "tau"] as const;
export type EffectBuiltin = (typeof EFFECT_BUILTINS)[number];

export const EFFECT_FUNCTIONS = [
  "abs",
  "min",
  "max",
  "clamp",
  "mix",
  "step",
  "smoothstep",
  "sin",
  "cos",
  "floor",
  "ceil",
  "fract",
  "pow",
  "sqrt",
  "wrap",
] as const;
export type EffectFnName = (typeof EFFECT_FUNCTIONS)[number];

export type EffectBinOp = "+" | "-" | "*" | "/" | "%";

export type EffectExpr =
  | { type: "lit"; value: number }
  | { type: "var"; name: string }
  | { type: "neg"; arg: EffectExpr }
  | { type: "bin"; op: EffectBinOp; left: EffectExpr; right: EffectExpr }
  | { type: "call"; name: EffectFnName; args: EffectExpr[] };

export type EffectParameter = {
  id: string;
  label: string;
  kind: "number";
  min: number;
  max: number;
  default: number;
};

/** Restricted expression source per channel. Optional `w` is RGBW white. */
export type EffectChannels = {
  r: string;
  g: string;
  b: string;
  w?: string;
};

/**
 * Portable source. The same object samples any node count without rewrite.
 */
export type EffectDefinition = {
  version: typeof EFFECT_CONTRACT_VERSION;
  id: string;
  name: string;
  parameters: EffectParameter[];
  channels: EffectChannels;
};

/**
 * Maps a definition onto one Light (and optional Segment). Parameter values
 * only — no node count, no pixels.
 */
export type EffectBinding = {
  id: string;
  definitionId: string;
  lightId: string;
  /** Saved Segment id, or null for the whole enrolled strip. */
  segmentId: string | null;
  values: Record<string, number>;
};

/**
 * Sample width for a binding. Changing `nodeCount` does not rewrite the Effect.
 * This is not Preview and not Apply.
 */
export type EffectDeployment = {
  id: string;
  bindingId: string;
  nodeCount: number;
};

export type EffectPixel = {
  r: number;
  g: number;
  b: number;
  w?: number;
};

export type EffectFrame = {
  nodeCount: number;
  timeSec: number;
  pixels: EffectPixel[];
};

export type EffectEnv = {
  u: number;
  t: number;
  i?: number;
  n?: number;
  values: Record<string, number>;
};
