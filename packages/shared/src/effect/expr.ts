import {
  EFFECT_FUNCTIONS,
  type EffectBinOp,
  type EffectEnv,
  type EffectExpr,
  type EffectFnName,
} from "./types.ts";

export const EFFECT_EXPR_SOURCE_MAX = 280;
export const EFFECT_EXPR_NODE_MAX = 64;
export const EFFECT_EXPR_DEPTH_MAX = 12;

const FN = new Set<string>(EFFECT_FUNCTIONS);
const ARITY: Record<EffectFnName, number> = {
  abs: 1,
  min: 2,
  max: 2,
  clamp: 3,
  mix: 3,
  step: 2,
  smoothstep: 3,
  sin: 1,
  cos: 1,
  floor: 1,
  ceil: 1,
  fract: 1,
  pow: 2,
  sqrt: 1,
  wrap: 1,
};

const IDENT = /^[a-z][a-z0-9_]*/;
const NUMBER = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;

class Reader {
  i = 0;
  nodes = 0;
  constructor(readonly s: string) {}
  skip(): void {
    while (this.i < this.s.length) {
      const ch = this.s[this.i];
      if (ch !== " " && ch !== "\t" && ch !== "\n" && ch !== "\r") break;
      this.i += 1;
    }
  }
  peek(): string {
    this.skip();
    return this.s[this.i] ?? "";
  }
  take(n = 1): string {
    const out = this.s.slice(this.i, this.i + n);
    this.i += n;
    return out;
  }
  count(): boolean {
    this.nodes += 1;
    return this.nodes <= EFFECT_EXPR_NODE_MAX;
  }
}

function readIdent(reader: Reader): string | null {
  reader.skip();
  const match = reader.s.slice(reader.i).match(IDENT);
  if (!match) return null;
  reader.i += match[0].length;
  return match[0];
}

function readNumber(reader: Reader): number | null {
  reader.skip();
  const match = reader.s.slice(reader.i).match(NUMBER);
  if (!match) return null;
  const value = Number(match[0]);
  if (!Number.isFinite(value)) return null;
  reader.i += match[0].length;
  return value;
}

function parsePrimary(reader: Reader, allowed: ReadonlySet<string>, depth: number): EffectExpr | null {
  if (depth > EFFECT_EXPR_DEPTH_MAX || !reader.count()) return null;
  const ch = reader.peek();
  if (ch === "(") {
    reader.take();
    const inner = parseSum(reader, allowed, depth + 1);
    if (!inner || reader.peek() !== ")") return null;
    reader.take();
    return inner;
  }
  const num = readNumber(reader);
  if (num !== null) return { type: "lit", value: num };
  const name = readIdent(reader);
  if (!name) return null;
  if (reader.peek() === "(") {
    if (!FN.has(name)) return null;
    reader.take();
    const args: EffectExpr[] = [];
    if (reader.peek() !== ")") {
      while (true) {
        const arg = parseSum(reader, allowed, depth + 1);
        if (!arg) return null;
        args.push(arg);
        const next = reader.peek();
        if (next === ",") {
          reader.take();
          continue;
        }
        if (next === ")") break;
        return null;
      }
    }
    reader.take();
    const fn = name as EffectFnName;
    if (args.length !== ARITY[fn]) return null;
    return { type: "call", name: fn, args };
  }
  if (!allowed.has(name)) return null;
  return { type: "var", name };
}

function parseUnary(reader: Reader, allowed: ReadonlySet<string>, depth: number): EffectExpr | null {
  if (reader.peek() === "+") {
    reader.take();
    return parseUnary(reader, allowed, depth + 1);
  }
  if (reader.peek() === "-") {
    if (depth + 1 > EFFECT_EXPR_DEPTH_MAX || !reader.count()) return null;
    reader.take();
    const arg = parseUnary(reader, allowed, depth + 1);
    return arg ? { type: "neg", arg } : null;
  }
  return parsePrimary(reader, allowed, depth);
}

function parseTerm(reader: Reader, allowed: ReadonlySet<string>, depth: number): EffectExpr | null {
  let left = parseUnary(reader, allowed, depth);
  if (!left) return null;
  while (true) {
    const op = reader.peek();
    if (op !== "*" && op !== "/" && op !== "%") return left;
    if (depth + 1 > EFFECT_EXPR_DEPTH_MAX || !reader.count()) return null;
    reader.take();
    const right = parseUnary(reader, allowed, depth + 1);
    if (!right) return null;
    left = { type: "bin", op: op as EffectBinOp, left, right };
  }
}

function parseSum(reader: Reader, allowed: ReadonlySet<string>, depth: number): EffectExpr | null {
  let left = parseTerm(reader, allowed, depth);
  if (!left) return null;
  while (true) {
    const op = reader.peek();
    if (op !== "+" && op !== "-") return left;
    if (depth + 1 > EFFECT_EXPR_DEPTH_MAX || !reader.count()) return null;
    reader.take();
    const right = parseTerm(reader, allowed, depth + 1);
    if (!right) return null;
    left = { type: "bin", op: op as EffectBinOp, left, right };
  }
}

/** Parse one restricted expression. Unknown names, functions, or leftover tokens refuse. */
export function parseEffectExpr(source: string, allowedVars: ReadonlySet<string>): EffectExpr | null {
  if (typeof source !== "string" || !source.trim() || source.length > EFFECT_EXPR_SOURCE_MAX) return null;
  const reader = new Reader(source);
  const expr = parseSum(reader, allowedVars, 0);
  reader.skip();
  if (!expr || reader.i !== reader.s.length) return null;
  return expr;
}

export function finiteNumber(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function callFn(name: EffectFnName, args: number[]): number {
  const a = args[0] ?? 0;
  const b = args[1] ?? 0;
  const c = args[2] ?? 0;
  switch (name) {
    case "abs":
      return Math.abs(a);
    case "min":
      return Math.min(a, b);
    case "max":
      return Math.max(a, b);
    case "clamp": {
      const x = args[0] ?? 0;
      const loIn = args[1] ?? 0;
      const hiIn = args[2] ?? 0;
      const lo = loIn < hiIn ? loIn : hiIn;
      const hi = loIn < hiIn ? hiIn : loIn;
      return x < lo ? lo : x > hi ? hi : x;
    }
    case "mix":
      return a * (1 - c) + b * c;
    case "step":
      return b < a ? 0 : 1;
    case "smoothstep": {
      const e0 = a;
      const e1 = b;
      const x = c;
      if (e0 === e1) return x < e0 ? 0 : 1;
      const t = (x - e0) / (e1 - e0);
      const u = t < 0 ? 0 : t > 1 ? 1 : t;
      return u * u * (3 - 2 * u);
    }
    case "sin":
      return Math.sin(a);
    case "cos":
      return Math.cos(a);
    case "floor":
      return Math.floor(a);
    case "ceil":
      return Math.ceil(a);
    case "fract":
    case "wrap":
      return a - Math.floor(a);
    case "pow":
      return Math.pow(a, b);
    case "sqrt":
      return a < 0 ? 0 : Math.sqrt(a);
  }
}

export function evaluateEffectExpr(expr: EffectExpr, env: EffectEnv): number {
  switch (expr.type) {
    case "lit":
      return finiteNumber(expr.value);
    case "var": {
      if (expr.name === "u") return finiteNumber(env.u);
      if (expr.name === "t") return finiteNumber(env.t);
      if (expr.name === "i") return env.i === undefined ? 0 : finiteNumber(env.i);
      if (expr.name === "n") return env.n === undefined ? 0 : finiteNumber(env.n);
      if (expr.name === "pi") return Math.PI;
      if (expr.name === "tau") return Math.PI * 2;
      const value = env.values[expr.name];
      return value === undefined ? 0 : finiteNumber(value);
    }
    case "neg":
      return finiteNumber(-evaluateEffectExpr(expr.arg, env));
    case "bin": {
      const left = evaluateEffectExpr(expr.left, env);
      const right = evaluateEffectExpr(expr.right, env);
      if (expr.op === "+") return finiteNumber(left + right);
      if (expr.op === "-") return finiteNumber(left - right);
      if (expr.op === "*") return finiteNumber(left * right);
      if (expr.op === "/") return right === 0 ? 0 : finiteNumber(left / right);
      return right === 0 ? 0 : finiteNumber(left % right);
    }
    case "call":
      return finiteNumber(callFn(expr.name, expr.args.map((arg) => evaluateEffectExpr(arg, env))));
  }
}

export function channelByte(value: number): number {
  const unit = finiteNumber(value);
  const clamped = unit < 0 ? 0 : unit > 1 ? 1 : unit;
  return Math.round(clamped * 255);
}
