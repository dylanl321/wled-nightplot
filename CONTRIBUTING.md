# Contributing

Nightplot Configure is the configure spine only. Read [AGENTS.md](AGENTS.md) and [CONSTITUTION.md](CONSTITUTION.md) before changing behaviour. Plane coordinates and agent duties: [docs/PLANE.md](docs/PLANE.md).

## Run

Needs Node 20+ and pnpm (`packageManager` in the root `package.json`).

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm dev
```

- App: `http://127.0.0.1:43180`
- API: `http://127.0.0.1:43181`

Without a box on the LAN: `pnpm fixture` (`127.0.0.1:48210`) or `pnpm dev:demo`. The fixture is not Hardware Done.

v2 prototype: `pnpm proto` → `http://127.0.0.1:43182`. See [docs/ui/README.md](docs/ui/README.md).

## Product words

Use: **Lights**, **Elements**, Preview, Apply, Blink, All Off.

Do not put these in chrome, routes, or user-facing copy: Yard, Tonight, Studio, Scene, Show, Schedule, Devices (as a noun).

A Light is one enrolled controller + one strip. An Element is a contiguous inclusive–exclusive range on that strip.

## PR expectations

- One CONFIG slice per PR. Gaps (CONFIG-9, CONFIG-11, CONFIG-45, …) are not the next R-slice. Do not start the next CONFIG ticket in the same run.
- Title like `CONFIG-N: …`. Body includes `Fixes CONFIG-N` (or equivalent) so intake can match.
- CHANGELOG and public docs land in the **same commit** as the code they describe.
- `pnpm test` and `pnpm typecheck` pass.
- Honesty stays: grey unreachable, Preview ≠ Apply, fail-closed Safe / provision, fixture ≠ Hardware Done.
- Adjacent bugs: leave them out of this PR. File or comment as a separate intake stub.

Branch off `main`. Do not force-push `main`.

## Plane (CONFIG agents)

REST only: `{PLANE_URL}/api/v1` with `X-API-Key`. Never `api.plane.so`. Never the Plane MCP. See [docs/PLANE.md](docs/PLANE.md).
