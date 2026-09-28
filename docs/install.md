# Install

Run Nightplot Configure on the machine in front of you with Node and pnpm. Docker / compose / GHCR: [deploy.md](deploy.md). This is a LAN utility — there is no authentication and no TLS.

## Needs

- Node 20+
- [pnpm](https://pnpm.io) (root `packageManager` is `pnpm@10.33.3`)
- A browser on the same machine as the app

Find (mDNS / SSDP) needs a LAN that actually carries those packets. The queries go out on each IPv4 that is not loopback and not `169.254.0.0/16`. mDNS rows are `_wled._tcp` answers. Typed address and `NIGHTPLOT_DISCOVERY_TARGETS` do not need multicast.

```bash
pnpm install
pnpm dev
```

- App: [http://127.0.0.1:43180](http://127.0.0.1:43180)
- API: [http://127.0.0.1:43181](http://127.0.0.1:43181)

```bash
pnpm typecheck
pnpm test
```

## Env

Copy [`.env.example`](../.env.example). Both apps read process env; there is no required `.env` file for the defaults.

| Variable | Default | What |
| --- | --- | --- |
| `NIGHTPLOT_API_URL` | `http://127.0.0.1:43181` | Web rewrite + server-side fetch |
| `NIGHTPLOT_API_HOST` | `127.0.0.1` | API bind |
| `NIGHTPLOT_API_PORT` | `43181` | API bind |
| `NIGHTPLOT_STORE_PATH` | `data/lights.json` | Enrolled Lights + Elements |
| `NIGHTPLOT_LED_PRODUCTS_PATH` | `data/led-products.json` | Operator LED product catalog (`/led-products`) |
| `NIGHTPLOT_DISCOVERY_TARGETS` | empty | Extra Find hosts (`host` or `host:port`) |
| `NIGHTPLOT_FIXTURE_PORT` | `48210` | Local in-process WLED-shaped stub |
| `NIGHTPLOT_FIXTURE_INFO_NAME_LAG` | off | Keep `/json/info` name stale after a cfg rename |
| `NIGHTPLOT_SIM_PORT` | `48211` | External-process WLED-shaped sim (HTTP) |
| `NIGHTPLOT_SIM_DDP_PORT` | `4048` | Sim DDP UDP listen |
| `NIGHTPLOT_WEB_HOST` | `127.0.0.1` | `next start` bind (`pnpm dev` stays loopback) |
| `NIGHTPLOT_WEB_PORT` | `43180` | `next start` port |
| `NIGHTPLOT_CORS_ORIGINS` | empty | Extra API CORS origins; defaults stay 127.0.0.1 / localhost :43180. `*` ignored |

`data/` is gitignored. The Lights store is created on first enroll. The LED product catalog is seeded on first API boot.

## Fixture

No box on the LAN:

```bash
pnpm fixture
```

serves WLED-shaped `/json` at `127.0.0.1:48210` (`apps/server/src/wled-fixture.ts`). Then `pnpm dev:demo` (sets `NIGHTPLOT_DISCOVERY_TARGETS=127.0.0.1:48210`) or type that address on Add a Light.

The fixture is a software stub for development. A green readback there is not proof that a real strip passed. `NIGHTPLOT_FIXTURE_NATIVE_TYPE=30` starts the bus as SK6812 RGBW (`TYPE_SK6812_RGBW`). Default is 22 (WS281x RGB). `NIGHTPLOT_FIXTURE_NATIVE_ORDER=1` starts a non-GRBW bus (`COL_ORDER_RGB` / RGBW on SK6812). Converting a bus to SK6812 RGBW writes GRBW (`order` 0); a same-type length or GPIO Apply keeps the colour order already on the box, and Strip names that order (including when it is not GRBW).

## Sim / e2e (not Hardware Done)

```bash
pnpm sim
```

serves a WLED-compatible HTTP API at `127.0.0.1:48211` and a DDP UDP listener on `4048` (`apps/server/src/wled-sim.ts`) as an **external process**. Type `127.0.0.1:48211` on Add a Light. Quiet caption is **software path only**. `pnpm test` spawns this process for enroll → provision → Apply → live/DDP, including Apply mismatch / unknown reread, All Off partial_failure, and incomplete delete.

This is not Hardware Done. `13rac1/wled-sim` is not vendored (AGPL). Its published JSON surface has no `/json/cfg` or `/json/live`, so the lane uses the in-house stub.

## Three Done layers

| Layer | What | Not |
| --- | --- | --- |
| Fixture | In-process / `pnpm fixture` — route and honesty unit tests | Hardware Done |
| Sim / e2e | External process / `pnpm sim` / CI spawn — enroll → provision → Apply → live/DDP | Hardware Done |
| Metal | Human benches on a real strip (CONFIG-26) | The only layer that can be Hardware Done |

## Prototype

```bash
pnpm proto
```

Serves `docs/ui/` on [http://127.0.0.1:43182](http://127.0.0.1:43182). See [ui/README.md](ui/README.md).
