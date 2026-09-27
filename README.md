# Nightplot Configure

Nightplot Configure is a LAN utility for home LED strips on WLED. Find a controller on the network, enroll it as a **Light**, describe **Elements** as ranges on the strip, **Preview** colour on the beads, then **Apply**. **Blink** identifies a box; **All Off** sits on the rack.

It is early software for a home network. There is no authentication and no TLS. Docker packages the same local/LAN run.

GitHub: [`dylanl321/wled-nightplot`](https://github.com/dylanl321/wled-nightplot) on `main`. The package name is `nightplot-configure`.

## Words

- A **Light** is one enrolled controller and one strip.
- An **Element** is a contiguous inclusive–exclusive range on that strip.
- **Preview** writes a temporary colour and brightness, then restores (or cancels without restore).
- **Apply** writes declared ranges (or Strip / Safe fields) and re-reads the controller. Success only when the readback matches.
- **Blink** pulses a Light or a Find candidate so you can see which box it is.
- **All Off** cancels live sessions without restoring, then powers off enrolled Lights.

## How it behaves

- An unreachable Light stays **grey**, with last-seen copy. The rack never shows a stored last colour.
- RGB vs RGBW on the beads and Inspect chip follows the attached LED product or the persisted strip driver. RGBW shows two dies. `/json/info` `leds.rgbw` is not labeled WS281x RGBW.
- Preview is temporary. Apply is what persists on the controller.
- All Off cancels without restoring the previous look.
- **Remove this Light** runs checks (Elements, live sessions, controller state). Unknown is not safe; there is no “I understand” override.
- Safe settings and first-time Strip provision write only understood, fingerprinted fields. Unsupported firmware is refused — nothing is written.
- The local WLED-shaped fixture is a software stub for development. A green readback there is not proof that a real strip passed.

After a Safe display-name write, the rack title uses the `/json/cfg` name even when metal `/json/info` still lags until reboot.

**Strip** sets WS281x type, node count, and GPIO on an enrolled Light. A catalog LED product fills that form from the SKU and its driver; fields still override. Attaching a product stores `ledProductId` on the Light and does not write the controller. Apply writes reviewed `/json/cfg` bus fields, then re-reads cfg and the snapshot. A mismatch stays on the failure UI. A length-changing Apply clips or drops declared Elements that run past the new strip, and flags leftover coverage on grow — the UI does not claim they still match.

## Quick start

Needs Node 20+ and [pnpm](https://pnpm.io).

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

`pnpm test` includes `apps/web` component tests (Vitest + Testing Library): Espalexa `portWarning` copy on Discover / the unenrolled tray, and Lights last-seen / unknown beads with Inspect Refresh as the one-Light probe. The list component does not re-probe.

More: [docs/install.md](docs/install.md). Docker / compose: [docs/deploy.md](docs/deploy.md).

## Docker

One image (`Dockerfile`); compose runs **web** + **api** in a shared network namespace (web rewrites to `127.0.0.1:43181`). There is no auth and no TLS — this is for a machine on your LAN. Find (mDNS / SSDP) from a container usually fails; typed address still works. Linux host networking is the path that can see multicast (`docker-compose.host.yml`).

```bash
docker build -t nightplot-configure .
docker compose up --build
```

- App: [http://127.0.0.1:43180](http://127.0.0.1:43180)
- API: [http://127.0.0.1:43181](http://127.0.0.1:43181)

Store volume: `lights-store` → `/data` (`lights.json`, `led-products.json`). `pnpm dev` bind stays loopback; compose publishes `0.0.0.0` on purpose.

GHCR build: Actions → Docker → Run workflow, or push to `main` / a `v*` tag. Images push only when GHCR login succeeds. Workflow does not run on pull requests.

Full build / run / multicast caveats: [docs/deploy.md](docs/deploy.md).

### Discover → Add without a box on the LAN

`pnpm fixture` serves a WLED-shaped `/json` at `127.0.0.1:48210`. Then either:

```bash
pnpm dev:demo
```

or type `127.0.0.1:48210` on Add a Light and **Check and add**. Open the Light for Inspect, then **Strip** to pick a catalog LED product or set WS281x / SK6812 RGBW / node count / GPIO and **Apply** (writes `/json/cfg`, then re-reads the snapshot), **Edit ranges** to declare Elements, **Test live** to Preview or Blink, or **Safe settings** for the small `/json/cfg` set. **All Off** is on the rail / thumb bar. **Remove this Light** on Inspect runs three checks and refuses until they complete. The fixture is a software stub for development, not a verified real strip.

By default the fixture updates `/json/info` and `/json/cfg` together. Real metal often keeps the old `/json/info` name until reboot. To simulate that lag: `NIGHTPLOT_FIXTURE_INFO_NAME_LAG=1 pnpm fixture`, or `POST http://127.0.0.1:48210/nightplot/info-name-lag` with `{ "on": true }`. Safe settings rename still updates the rack title from cfg. `{ "on": false }` copies cfg → info. `NIGHTPLOT_FIXTURE_NATIVE_TYPE=30` starts the fixture bus as SK6812 RGBW; default is 22 (WS281x RGB). A fixture readback is still a development stub.

**Ports.** Find uses a real advertised port: SSDP `LOCATION`, mDNS SRV. It does not assume `:80`. A host with no port from find is listed as needs host:port — it is not Add-able. Typed address is the escape hatch (a typed host with no port still means `:80`). Listed hosts use `displayHost` and hide default `:80` (a not-WLED reject on port 80 is `192.168.1.80`, not `192.168.1.80:80`). The fixture is **not** on 80; type `127.0.0.1:48210` or use the demo target list.

Enrolled Lights and declared Elements persist in `data/lights.json` (override with `NIGHTPLOT_STORE_PATH`). Operator LED products persist in `data/led-products.json` (override with `NIGHTPLOT_LED_PRODUCTS_PATH`). Find Lights also probes `NIGHTPLOT_DISCOVERY_TARGETS` (comma-separated `host` / `host:port` — include the port when it is not 80). Find probes up to **four** collected hosts at a time; a dead probe aborts in about 3 s and does not block the rest of the scan. After `/json/info` answers, `/json/state` is a short enrichment — a hang does not add another 3 s. The listed reason uses the time that actually elapsed, or generic **probe failed** when the refuse was instant.

## Docs

| Doc | What |
| --- | --- |
| [docs/overview.md](docs/overview.md) | What Configure is and how the flow works |
| [docs/install.md](docs/install.md) | Install, env, fixture, proto |
| [docs/deploy.md](docs/deploy.md) | Docker / compose / GHCR on a LAN |
| [docs/architecture.md](docs/architecture.md) | Real paths and symbols |
| [docs/ui/README.md](docs/ui/README.md) | v2 prototype (visual source of truth) |
| [docs/PLANE.md](docs/PLANE.md) | CONFIG tickets, REST-only Plane duties |
| [AGENTS.md](AGENTS.md) | Slice duties and product words |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Tests, PRs, product words |
| [CONSTITUTION.md](CONSTITUTION.md) | Non-negotiables |
| [SECURITY.md](SECURITY.md) | LAN assumptions, how to report |
| [LICENSE](LICENSE) | MIT |
| [CHANGELOG.md](CHANGELOG.md) | What landed |

## API

| Method | Path | What |
| --- | --- | --- |
| GET | `/health` | Slice + liveness |
| GET | `/api/catalogs` | Controller / strip / discovery seams, named strip presets (`stripPresets`), operator LED products (`ledProducts`) |
| GET | `/api/led-products` | Nightplot LED product catalog (seeded SKUs + operator creates). Does not write WLED. |
| GET | `/api/led-products/:id` | One catalog row. 404 if missing. |
| POST | `/api/led-products` | Create a product. 422 on unknown `driverId`, bad `formFactor`, or bad defaults. Does not write WLED. |
| GET | `/api/lights` | Enrolled Lights (live snapshot or grey + last-seen), declared Elements, unenrolled tray |
| GET | `/api/lights/:id` | Inspect payload: identity, declared Elements, reported segments, drift, live session |
| GET | `/api/lights/:id/live` | Same Light plus current `/json/live` beads |
| PATCH | `/api/lights/:id/elements` | Save declared ranges. 422 on invert / overlap / over-ledCount. Does not write WLED. |
| POST | `/api/lights/:id/apply` | Write declared ranges, re-read snapshot. 200 only on match. 409 keeps the failure. |
| POST | `/api/lights/:id/readdress` | `{ host }` — probe first, same-MAC continuity, persist address + last-good snapshot. |
| POST | `/api/lights/:id/preview` | Temporary colour/brightness on one Element. Reads `/json/live`. `reported` stays range rails; match counts are `liveMatch`. |
| POST | `/api/lights/:id/preview/end` | Restore previous look (`restore: false` cancels without restore). |
| POST | `/api/lights/:id/preview/seen` | Person rung: `{ seen: "yes" \| "no" }`. Not Hardware Done. |
| POST | `/api/lights/:id/blink` | Identify pulse. Same `reported` / `liveMatch` contract as Preview. Restore with `/blink/end` (UI does this after 3 s). |
| POST | `/api/discover/blink` | `{ host }` — pulse a candidate, then restore. |
| POST | `/api/discover` | LAN find (mDNS, SSDP, env targets). Probes up to four collected hosts at a time. Does not enroll. |
| GET | `/api/discover` | Last find/probe rows |
| POST | `/api/discover/probe` | `{ host }` — one address. Public IPs refused before HTTP. |
| POST | `/api/lights` | `{ host }` — enroll. Fails closed without a WLED snapshot. Duplicate host → 409. |
| POST | `/api/apply` | 400 — use `/api/lights/:id/apply` |
| POST | `/api/all-off` | Cancel live sessions without restore, then `{ on: false }` each enrolled Light. Body `{ lightIds }` retries only those. |
| GET | `/api/lights/:id/delete-checks` | Elements / live sessions / controller state. Unknown is not safe. |
| DELETE | `/api/lights/:id` | 422 until every check is `ok`. Does not write the controller. |
| GET | `/api/lights/:id/safe` | Fingerprinted Safe settings from `/json/cfg`. Empty fingerprint → refuse. |
| POST | `/api/lights/:id/safe` | `{ settings }` — write only understood fields, then reread. 422 if unsupported. A matched display-name write patches the enrolled title from cfg even when `/json/info` still lags. |
| PATCH | `/api/lights/:id/led-product` | `{ ledProductId }` — attach a catalog product or `null` for manual fields. Persists on the Light. Does not write WLED. |
| GET | `/api/lights/:id/provision` | First-time strip bus from `/json/cfg` (`hw.led.ins[0]`). Empty / multi-bus / unsupported firmware → refuse. |
| POST | `/api/lights/:id/provision` | `{ provision: { ledType, length, gpio } }` — `ws281x` or `sk6812-rgbw`. Writes reviewed cfg bus fields, then rereads cfg and snapshot. 200 only on match. 409 keeps the failure. 422 if unsupported. Unknown types are not written. A successful length change reconciles declared Elements (clip / drop / flag leftover coverage) and returns `provisionWrite.ranges`. |

## UI

| Path | What |
| --- | --- |
| `/` | Lights rack + unenrolled tray. All Off on the rail / thumb bar |
| `/discover` | Find / type an address / add |
| `/lights/:id` | Inspect — identity + StripBeads + declared vs reported + Delete checks |
| `/lights/:id?mode=strip` | Strip — catalog product or WS281x / SK6812 RGBW plus length / GPIO; fields still override. Apply writes `/json/cfg` then re-reads. Mismatch stays. |
| `/lights/:id?mode=safe` | Safe settings — name, boot, transition, current limit; refuse if unsupported. A rename updates the title from `/json/cfg` without waiting for reboot. |
| `/lights/:id?mode=ranges` | Edit ranges — draft save, Apply write+reread, failed Apply stays |
| `/lights/:id?mode=live` | Test live — Preview / Blink, proof ladder, `/json/live` beads |

## Layout

| Path | What |
| --- | --- |
| `apps/web` | Quiet-utility Lights rack, Discover, Inspect / Strip / Edit ranges / Test live / Safe settings, All Off, Delete, `StripBeads` |
| `apps/server` | Discover/connect, JSON Light store, LED product catalog, WLED snapshot + live + Apply + Strip provision + All Off + Delete + Safe settings + fixture |
| `packages/shared` | LAN guard, WLED parse, catalogs, Light / Element types |
| `docs/ui/` | Nightplot Configure v2 prototype. See [docs/ui/README.md](docs/ui/README.md). |
| `docs/PLANE.md` | CONFIG tickets, REST-only Plane duties. |
| `Dockerfile` / `docker-compose.yml` | Local/LAN image + compose. See [docs/deploy.md](docs/deploy.md). |

## Prototype

```bash
pnpm proto
```

Then open [http://127.0.0.1:43182/Nightplot%20Configure%20v2.dc.html](http://127.0.0.1:43182/Nightplot%20Configure%20v2.dc.html).

Plane project: Configure (`CONFIG`) in workspace `nightplot`. See [docs/PLANE.md](docs/PLANE.md).
