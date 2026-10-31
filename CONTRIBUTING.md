# Contributing

Nightplot Configure is a LAN utility for a yard of WLED controllers: find them, enroll them as Lights, describe outputs and Segments, Preview live, Apply, manage a fleet, All Off. Read [AGENTS.md](AGENTS.md) and [CONSTITUTION.md](CONSTITUTION.md) before changing behaviour. Plane coordinates and agent duties: [docs/PLANE.md](docs/PLANE.md).

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

Without a box on the LAN: `pnpm fixture` (`127.0.0.1:48210`) or `pnpm dev:demo`. The fixture is a software stub for development, not a verified real strip. `pnpm sim` is a separate **external-process** WLED-shaped node (`127.0.0.1:48211`, DDP `4048`) for the enroll → provision → Apply → live/DDP lane. Sim Quiet caption is **software path only**. Neither layer is Hardware Done. Metal benches stay human.

v2 prototype: `pnpm proto` → `http://127.0.0.1:43182`. See [docs/ui/README.md](docs/ui/README.md).

## Product words

Use: **Lights**, **Segments**, Preview, Apply, Blink, All Off.

Fleet and show words are also in play: **Yard**, **Prop**, **Zone**, **Look**, **Schedule**.

A Light is one enrolled controller. It may drive several outputs. A Segment is an inclusive–exclusive range on one output. Gaps are allowed.

Use this product’s vocabulary in chrome, routes, and user-facing copy. Existing `Element` types and `elements` keys stay compatible.

## PR expectations

- One CONFIG slice per PR, or one GitHub epic slice when that is the ticket. Gaps are not the next R-slice. Do not start the next CONFIG ticket in the same run.
- Title like `CONFIG-N: …` or the GitHub issue it closes. Body includes `Fixes CONFIG-N` or `Fixes #N` so intake can match.
- CHANGELOG and public docs land in the **same commit** as the code they describe.
- `pnpm lint`, `pnpm typecheck` and `pnpm test` pass (CI runs all three on every pull request).
- Honesty stays: unreachable beads stay grey with last-seen (never last colour); Preview is temporary and Apply persists; Safe / provision refuse unsupported firmware; the fixture is a development stub, not Hardware Done.
- Adjacent bugs: leave them out of this PR. File or comment as a separate intake stub.

Branch off `main`. Do not force-push `main`.

## Plane (CONFIG agents)

REST only: `{PLANE_URL}/api/v1` with `X-API-Key`. Never `api.plane.so`. Never the Plane MCP. See [docs/PLANE.md](docs/PLANE.md).
