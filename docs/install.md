# Install

Run Nightplot Configure on the machine in front of you with Node and pnpm. Docker / compose / GHCR: [deploy.md](deploy.md). This is a LAN utility — there is no authentication and no TLS.

## Needs

- Node 20+
- [pnpm](https://pnpm.io) (root `packageManager` is `pnpm@10.33.3`)
- A browser on the same machine as the app

Find (mDNS / SSDP) needs a LAN that actually carries those packets. Typed address and `NIGHTPLOT_DISCOVERY_TARGETS` do not.

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
| `NIGHTPLOT_LED_PRODUCTS_PATH` | `data/led-products.json` | Operator LED product catalog |
| `NIGHTPLOT_DISCOVERY_TARGETS` | empty | Extra Find hosts (`host` or `host:port`) |
| `NIGHTPLOT_FIXTURE_PORT` | `48210` | Local WLED-shaped stub |
| `NIGHTPLOT_FIXTURE_INFO_NAME_LAG` | off | Keep `/json/info` name stale after a cfg rename |
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

The fixture is a software stub for development. A green readback there is not proof that a real strip passed.

## Prototype

```bash
pnpm proto
```

Serves `docs/ui/` on [http://127.0.0.1:43182](http://127.0.0.1:43182). See [ui/README.md](ui/README.md).
