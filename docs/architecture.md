# Architecture

One code basis. New controllers or strip types register a catalog member; they do not fork the Lights / Elements / live stack.

This is early software. Paths below are the real tree on `main`.

## Layout

| Path | Package | Role |
| --- | --- | --- |
| `apps/web` | `@nightplot/web` | Quiet-utility Next.js shell. Routes: `/`, `/discover`, `/lights/[id]` |
| `apps/server` | `@nightplot/server` | Hono API, Discover, JSON store, WLED I/O, fixture |
| `packages/shared` | `@nightplot/shared` | Types, catalogs, LAN guard, parse, range / live / safe / provision |
| `docs/ui/` | — | v2 prototype (visual source of truth) |

Web talks to the API by rewrite: `/api/:path*` and `/health` → `NIGHTPLOT_API_URL` (default `http://127.0.0.1:43181`). Browser fetches use same-origin paths (`apps/web/src/lib/api.ts`).

## Catalog seams

First members. Home directories are the registration point.

| Seam | First member | Home | Notes |
| --- | --- | --- | --- |
| Controller | WLED | `packages/shared/src/controller/` | `wledController` — `wired: true`, capabilities through provision |
| Strip / driver | WS281x | `packages/shared/src/strip/` | `ws281xStrip` — `wired: false`. Pixels go through WLED, not a local driver |
| Discovery | mDNS / SSDP / address probe | `packages/shared/src/discovery/` | `implementation: "registered"`. Empty results are honest |

`GET /api/catalogs` returns `catalogSnapshot()` (`packages/shared/src/catalog.ts`). `CURRENT_SLICE` is `"R6"`. Named strip presets live in `packages/shared/src/strip/presets.ts` (`stripPresets` on that payload).

`registered` means the slot exists. It is not proof hardware passed. `ControllerDescriptor.implementation` / `wired` / `capabilities` stay honest (`packages/shared/src/controller/types.ts`).

## Domain types

| Symbol | File | Meaning |
| --- | --- | --- |
| `Light` | `packages/shared/src/lights.ts` | One enrolled controller + one strip |
| `Element` | same | Inclusive–exclusive range on that strip |
| `BeadColor` | `packages/shared/src/bead.ts` | Colour, `null` (off), or `"unknown"` (grey) |
| `WledSnapshot` | `packages/shared/src/wled/snapshot.ts` | Parsed `/json` (info + state) |
| `WledSafeSettings` | `packages/shared/src/safe.ts` | Small Safe set; fingerprint-gated |
| `WledStripProvision` | `packages/shared/src/provision.ts` | First-time bus: type / length / GPIO |

Unreachable: `markUnreachable` in `apps/server/src/domain.ts` clears `on` / `brightness`. `beadFor` returns `"unknown"` — never a stored last colour.

## Server

`createApp` in `apps/server/src/app.ts` is the rack. Boot: `apps/server/src/index.ts`.

| Piece | Symbol | File |
| --- | --- | --- |
| HTTP | `createApp` | `apps/server/src/app.ts` |
| Store | `FileLightsStore` | `apps/server/src/store/lights-store.ts` |
| Probe | `createWledProbe` | `apps/server/src/wled/client.ts` (`TIMEOUT_MS` 3000) |
| Live write / `/json/live` | `createWledWriter`, `createWledLiveReader` | `apps/server/src/wled/live.ts` |
| cfg | `createWledCfgReader`, `createWledCfgWriter` | `apps/server/src/wled/cfg.ts` |
| Live sessions | `createLiveEngine` | `apps/server/src/live/engine.ts` |
| Find collect | `createCollector` | `apps/server/src/discovery/collect.ts` |
| Find probe bound | `FIND_PROBE_CONCURRENCY` (4) | `apps/server/src/discovery/map-limit.ts` |
| Fixture | `createFixtureBox` | `apps/server/src/wled-fixture-box.ts` |

`GET /health` returns `{ ok, service: "nightplot-configure", slice: CURRENT_SLICE }`.

`GET /api/lights` still calls `refreshOne` (a probe) for every enrolled Light, then `lightDetail`. The Lights **list component** does not start its own probes; Inspect Refresh is the one-Light UI probe. The server list path is a known gap — leave it unless that gap is the slice you are on.

## LAN guard

`decideProbeAddress` / `isLanAllowed` / `displayHost` / `parseHostPort` live in `packages/shared/src/net/address.ts`. Public addresses are `disallowed-address` before HTTP. See [SECURITY.md](../SECURITY.md).

Find must use an advertised port (SSDP `LOCATION` in `apps/server/src/discovery/parse.ts`, mDNS SRV) or list the row as needs host:port. Typed host with no port still means `:80`.

## Persistence

`FileLightsStore` writes `{ version: 1, lights, elements }` to `data/lights.json` (or `NIGHTPLOT_STORE_PATH`).

## Stubs / NYI (honest)

| Thing | Status |
| --- | --- |
| Docker / compose / GHCR | Image + compose for local/LAN run. See [deploy.md](deploy.md). No auth or TLS |
| Local WS281x driver | Catalog member registered; `wired: false` |
| Auth / public bind | Not present. Defaults loopback. Containers bind `0.0.0.0` for published ports — LAN publish, not a public-internet deploy |
| Hardware Done | Not claimed. The fixture is a software stub for development |

API routes: [README.md](../README.md#api). UI routes: [README.md](../README.md#ui).
