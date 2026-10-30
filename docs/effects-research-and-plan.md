# Effects — research and plan

Nightplot Configure authors **Lights** and **Segments** on WLED. This note is the portable **Effect** contract: one source that can be sampled onto any node count, Previewed as a temporary look, and later Applied as a named WLED preset that keeps running after Nightplot is closed.

There is no Effect editor, live path, or firmware runtime on the tree yet. The shared package holds the contract and evaluator only. A software frame is not a lit strip.

## Why a portable Effect

WLED ships a fixed catalogue of firmware FX ids. Those recipes are tied to the bus they run on. Lengthen or shorten the strip and the look changes, or the author rewrites the source.

A Nightplot Effect is a colour function of **normalized position** and **time**. Position `u` is 0 on the first node and 1 on the last, for any node count greater than one (a single node is `u = 0`). The same `EffectDefinition` paints 30 LEDs or 150. Node count is a sample argument, not part of the artwork.

That is the portability bar: resample without rewriting source.

## Honesty

- **Preview is temporary. Apply persists.** A later virtual or physical Preview must restore (or cancel without restore). Apply is a distinct write — a named WLED preset, so the Effect can run with Nightplot stopped. Sampling in this package does neither.
- A software frame, fixture readback, or sim enroll is not Hardware Done. A lit strip on a real controller is a later bench.
- Unreachable beads stay grey with last-seen copy. An Effect sample is not a last colour and is not shown as live state.
- A registered catalog member is a slot. An Effect row on disk later is not proof the controller ran it.

## Contract

Home: `packages/shared/src/effect/`.

| Type | Owns | Does not own |
| --- | --- | --- |
| `EffectDefinition` | Versioned source: id, name, number parameters, restricted expressions for `r` / `g` / `b` and optional `w` | Node count, Light id, pixels, presets |
| `EffectBinding` | Which Light (and optional Segment) plus parameter values | Node count, pixels, Apply |
| `EffectDeployment` | Sample width (`nodeCount`) for one binding | Source rewrite, Preview, Apply |

`sampleEffect` walks every node, sets `u`, `t`, `i`, `n`, and evaluates the channels. `sampleEffectAt` evaluates the same source at one `u` so a 30-node frame and a 150-node frame can be compared at the same position. `sampleBoundEffect` requires the definition, binding, and deployment ids to line up; a mismatch refuses.

Changing `EffectDeployment.nodeCount` does not mutate the definition. The evaluator returns integer 0–255 per channel. It writes nothing to WLED.

## Restricted expression grammar

Expressions are a closed arithmetic language. There is no `eval`, no assignment, no loops, no objects, no member access, no user-defined functions, and no strings.

```
expr     = sum
sum      = term { ("+" | "-") term }
term     = unary { ("*" | "/" | "%") unary }
unary    = "+" unary | "-" unary | call
call     = IDENT "(" [ expr { "," expr } ] ")" | primary
primary  = NUMBER | IDENT | "(" expr ")"
IDENT    = [a-z] [a-z0-9_]*
NUMBER   = ordinary decimal or scientific (finite only)
```

Whitespace is allowed between tokens. The parser refuses leftover tokens, unknown names, unknown functions, wrong arity, empty source, and trees past a small depth / node / length cap.

### Built-in names

| Name | Meaning |
| --- | --- |
| `u` | Normalized position in `[0, 1]` (`index / (nodeCount - 1)`, or `0` when `nodeCount` is 1) |
| `t` | Time in seconds |
| `i` | Zero-based node index. Discrete. Does **not** resample smoothly |
| `n` | Node count. Discrete. Does **not** resample smoothly |
| `pi` | π |
| `tau` | 2π |

Portable artwork uses `u` and `t` (and parameters). `i` and `n` stay available for count-off style patterns; those looks change when the strip length changes, by design.

Parameter ids are the same identifier form. They must not collide with built-ins or function names.

### Functions

Arguments are numbers. Results that are not finite become 0. Division or remainder by 0 is 0. `sqrt` of a negative is 0.

| Call | Arity | Result |
| --- | --- | --- |
| `abs(x)` | 1 | Absolute value |
| `min(a, b)` | 2 | Lesser |
| `max(a, b)` | 2 | Greater |
| `clamp(x, lo, hi)` | 3 | `x` limited to the closed interval; `lo`/`hi` may be swapped |
| `mix(a, b, t)` | 3 | `a * (1 - t) + b * t` |
| `step(edge, x)` | 2 | `0` if `x < edge`, else `1` |
| `smoothstep(e0, e1, x)` | 3 | Hermite step; equal edges behave as `step` |
| `sin(x)` `cos(x)` | 1 | Radians |
| `floor(x)` `ceil(x)` | 1 | |
| `fract(x)` `wrap(x)` | 1 | `x - floor(x)` → `[0, 1)` |
| `pow(a, b)` | 2 | |
| `sqrt(x)` | 1 | |

Channel output is clamped to `[0, 1]` and stored as `round(value * 255)`.

A later graph editor compiles nodes and edges into these same channel strings. The firmware runtime, if it ships, walks this grammar — not JavaScript and not a C++ FX as the authoring source.

## Worked sample

This definition is the unit-test artwork. It is sampled at 30 nodes and at 150 nodes. Endpoints match. Each node’s colour matches `sampleEffectAt` at that node’s `u`. The JSON is unchanged after both samples.

```json
{
  "version": 1,
  "id": "portable-gradient",
  "name": "Portable gradient",
  "parameters": [
    { "id": "speed", "label": "Speed", "kind": "number", "min": 0, "max": 4, "default": 0.5 }
  ],
  "channels": {
    "r": "clamp(0.5 + 0.5 * sin(tau * (u - t * speed)), 0, 1)",
    "g": "u",
    "b": "1 - u"
  }
}
```

## Planned path (not this slice)

The platform stays one code basis. New work registers on this contract. It does not fork Lights / Segments / live per vendor.

1. **Portable contract + shared evaluator** — this document and `packages/shared/src/effect/`. Software check only.
2. **Controller runtime** — a Nightplot usermod on QuinLED-class WLED, targeted at **0.15.3** and **16.0.1**. Comps and sim alone are not a pass. A Dig-Quad (or equivalent) bench is required. Not Hardware Done from docs.
3. **Effect library** — versioned `.nightplot-effect.json` load / list / save on this schema.
4. **Virtual Preview** — canvas sample of the same expressions. Must never look Applied. Unsafe expressions stay refused.
5. **Physical Preview** — temporary live-engine write, restorable, fail-closed. Same honesty as today’s Preview. Not Apply.
6. **Apply → named WLED preset** — persist so the Effect runs with Nightplot stopped. Activity and readback say Applied, not Preview.
7. **Visual graph** — a small node graph that compiles to this `EffectDefinition`. No layers, timeline, or 2D/3D stage.
8. **Qualification** — a matrix covering virtual Preview, physical Preview, Apply, both WLED generations, and the honesty bars above.

## Out of scope for the platform

Layers and timelines, 2D/3D stages, particles, audio reactivity, public share, multi-Light sync, and ARTI-FX / GIF / C++ as the authoring foundation.

This slice does not flash firmware, open a Preview session, write a preset, or ship a graph UI.
