# Nightplot Configure

Configure spine for home LED strips. Discover a controller, enroll it as a **Light**, describe **Elements** as ranges on the strip, Preview live, then Apply. All Off has a home.

This is not a lighting control room. It does not host playback, mapping, or scheduling. It does not ship Yard, Tonight, Studio, Scene, Show, Schedule, or Devices-as-noun chrome.

The product is **not production-ready**. This repo has production-*shaped* documentation and governance. Docker / compose / GHCR is CONFIG-45 — not this tree.

GitHub today is `dylanl321/wled-nightplot` (`main`). The package name is `nightplot-configure`.

## Honesty

- Unreachable beads are grey, with last-seen copy. Never the last colour.
- Preview is not Apply.
- All Off cancels without restoring.
- Delete is a check that runs, not an “I understand” override on unknown.
- A registered catalog member is not Hardware Done. A stub endpoint must say it sent nothing.
- The local WLED-shaped fixture is a software stub — **not Hardware Done**.

R6 wires the small Safe settings set on an enrolled Light, gated by the firmware’s `/json/cfg` fingerprint. Unsupported firmware is refused — nothing is written. After a display-name write, the rack title uses the `/json/cfg` name even when metal `/json/info` still lags until reboot.

CONFIG-40 adds first-time **Strip** provision on an enrolled Light: WS281x type, node count, and GPIO. CONFIG-41 adds named catalog presets (common WS281x length / GPIO defaults) that fill that form; fields still override. Apply writes reviewed `/json/cfg` bus fields, then re-reads cfg and the snapshot. A mismatch stays on the failure UI. CONFIG-43: a length-changing Apply clips or drops declared Elements that run past the new strip, and flags leftover coverage on grow — the UI does not claim they still match without that story.

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

More: [docs/install.md](docs/install.md).

### Discover → Add without a box on the LAN

`pnpm fixture` serves a WLED-shaped `/json` at `127.0.0.1:48210`. Then either:

```bash
pnpm dev:demo
```

or type `127.0.0.1:48210` on Add a Light and **Check and add**. Open the Light for Inspect, then **Strip** to pick a named default or set WS281x / node count / GPIO and **Apply** (writes `/json/cfg`, then re-reads the snapshot), **Edit ranges** to declare Elements, **Test live** to Preview or Blink, or **Safe settings** for the small `/json/cfg` set. **All Off** is on the rail / thumb bar. **Remove this Light** on Inspect runs three checks and refuses until they complete. The fixture is a software stub — not Hardware Done.

By default the fixture updates `/json/info` and `/json/cfg` together. Real metal often keeps the old `/json/info` name until reboot. To simulate that lag: `NIGHTPLOT_FIXTURE_INFO_NAME_LAG=1 pnpm fixture`, or `POST http://127.0.0.1:48210/nightplot/info-name-lag` with `{ "on": true }`. Safe settings rename still updates the rack title from cfg. `{ "on": false }` copies cfg → info.

**Ports.** Find uses a real advertised port: SSDP `LOCATION`, mDNS SRV. It does not assume `:80`. A host with no port from find is listed as needs host:port — it is not Add-able. Typed address is the escape hatch (a typed host with no port still means `:80`). Listed hosts use `displayHost` and hide default `:80` (a not-WLED reject on port 80 is `192.168.1.80`, not `192.168.1.80:80`). The fixture is **not** on 80; type `127.0.0.1:48210` or use the demo target list.

Enrolled Lights and declared Elements persist in `data/lights.json` (override with `NIGHTPLOT_STORE_PATH`). Find Lights also probes `NIGHTPLOT_DISCOVERY_TARGETS` (comma-separated `host` / `host:port` — include the port when it is not 80). Find probes up to **four** collected hosts at a time; a dead probe aborts in about 3 s and does not block the rest of the scan. After `/json/info` answers, `/json/state` is a short enrichment — a hang does not add another 3 s. The listed reason uses the time that actually elapsed, or generic **probe failed** when the refuse was instant.

## Docs

| Doc | What |
| --- | --- |
| [docs/overview.md](docs/overview.md) | What Configure is / is not |
| [docs/install.md](docs/install.md) | Install, env, fixture, proto |
| [docs/deploy.md](docs/deploy.md) | High-level run shape. Docker is CONFIG-45 |
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
| GET | `/api/catalogs` | Controller / strip / discovery seams, plus named strip presets (`stripPresets`) |
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
| GET | `/api/lights/:id/provision` | First-time strip bus from `/json/cfg` (`hw.led.ins[0]`). Empty / multi-bus / unsupported firmware → refuse. |
| POST | `/api/lights/:id/provision` | `{ provision: { ledType, length, gpio } }` — WS281x only. Writes reviewed cfg bus fields, then rereads cfg and snapshot. 200 only on match. 409 keeps the failure. 422 if unsupported. A successful length change reconciles declared Elements (clip / drop / flag leftover coverage) and returns `provisionWrite.ranges`. |

## UI

| Path | What |
| --- | --- |
| `/` | Lights rack + unenrolled tray. All Off on the rail / thumb bar |
| `/discover` | Find / type an address / add |
| `/lights/:id` | Inspect — identity + StripBeads + declared vs reported + Delete checks |
| `/lights/:id?mode=strip` | Strip — named WS281x defaults fill type / length / GPIO; fields still override. Apply writes `/json/cfg` then re-reads. Mismatch stays. |
| `/lights/:id?mode=safe` | Safe settings — name, boot, transition, current limit; refuse if unsupported. A rename updates the title from `/json/cfg` without waiting for reboot. |
| `/lights/:id?mode=ranges` | Edit ranges — draft save, Apply write+reread, failed Apply stays |
| `/lights/:id?mode=live` | Test live — Preview / Blink, proof ladder, `/json/live` beads |

## Layout

| Path | What |
| --- | --- |
| `apps/web` | Quiet-utility Lights rack, Discover, Inspect / Strip / Edit ranges / Test live / Safe settings, All Off, Delete, `StripBeads` |
| `apps/server` | Discover/connect, JSON store, WLED snapshot + live + Apply + Strip provision + All Off + Delete + Safe settings + fixture |
| `packages/shared` | LAN guard, WLED parse, catalogs, Light / Element types |
| `docs/ui/` | Nightplot Configure v2 prototype. See [docs/ui/README.md](docs/ui/README.md). |
| `docs/PLANE.md` | CONFIG tickets, REST-only Plane duties. |

## Prototype

```bash
pnpm proto
```

Then open [http://127.0.0.1:43182/Nightplot%20Configure%20v2.dc.html](http://127.0.0.1:43182/Nightplot%20Configure%20v2.dc.html).

## Publishing name

This GitHub repo is `dylanl321/wled-nightplot`. The package and Plane project stay **Nightplot Configure** / `nightplot-configure`. Renaming the GitHub repo is out of scope here.

Plane project: Configure (`CONFIG`) in workspace `nightplot`. See [docs/PLANE.md](docs/PLANE.md).
