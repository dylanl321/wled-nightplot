# Contributing

Nightplot Configure is a LAN utility: find a WLED controller, enroll it as a Light, describe Elements as ranges, Preview live, Apply, manage a few, All Off. Read [AGENTS.md](AGENTS.md) and [CONSTITUTION.md](CONSTITUTION.md) before changing behaviour. Plane coordinates and agent duties: [docs/PLANE.md](docs/PLANE.md).

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

Without a box on the LAN: `pnpm fixture` (`127.0.0.1:48210`) or `pnpm dev:demo`. The fixture is a software stub for development, not a verified real strip.

v2 prototype: `pnpm proto` → `http://127.0.0.1:43182`. See [docs/ui/README.md](docs/ui/README.md).

## Product words

Use: **Lights**, **Elements**, Preview, Apply, Blink, All Off.

A Light is one enrolled controller + one strip. An Element is a contiguous inclusive–exclusive range on that strip.

Use this product’s vocabulary in chrome, routes, and user-facing copy.

## PR expectations

- One CONFIG slice per PR. Gaps are not the next R-slice. Do not start the next CONFIG ticket in the same run.
- Title like `CONFIG-N: …`. Body includes `Fixes CONFIG-N` (or equivalent) so intake can match.
- CHANGELOG and public docs land in the **same commit** as the code they describe.
- `pnpm test` and `pnpm typecheck` pass.
- Honesty stays: unreachable beads stay grey with last-seen (never last colour); Preview is temporary and Apply persists; Safe / provision refuse unsupported firmware; the fixture is a development stub, not Hardware Done.
- Adjacent bugs: leave them out of this PR. File or comment as a separate intake stub.

Branch off `main`. Do not force-push `main`.

## Plane (CONFIG agents)

REST only: `{PLANE_URL}/api/v1` with `X-API-Key`. Never `api.plane.so`. Never the Plane MCP. See [docs/PLANE.md](docs/PLANE.md).
