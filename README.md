# Nightplot Configure

See [Locate and create Segments](docs/segment-locate.md) for the persistent
cursor, auto-scan, keyboard controls, and adjustable Preview background brightness.

Nightplot Configure is a LAN utility for home LED strips on WLED. Find a controller on the network, enroll it as a **Light**, describe **Segments** as ranges on the strip, **Preview** colour on the beads, then **Apply**. **Blink** identifies a box; **All Off** sits on the rack.

The top-level [Settings page](http://127.0.0.1:43180/settings) saves shared Nightplot preferences in `data/settings.json` (or `NIGHTPLOT_SETTINGS_PATH`). It controls the dark/light theme, visible-tab background Find interval (Off, 30, 60, 120 seconds), an eight-colour Segment palette, and opt-in backup retention. Manual Find is always available. A stale browser revision must reload before saving. Preference Save never writes WLED; each Light still has its own Settings tab for hardware and network.

Backups now include preferences; restoring an older backup without them leaves current preferences in place. Retention is Off by default and storage refuses once full. Opting in rotates the oldest eligible backups up to the 100-file cap; pinned copies, the newest Nightplot recovery copy and the newest complete WLED export per Light are protected. Settings previews the exact copies to remove; pinning, downloads and manual clearing stay on Backups. WLED exports omit passwords.

This Settings work is not complete: Settings can read each Light’s fresh `cfg.json` after checking its MAC and return a firmware/source digest, but bulk WLED configuration review and upload are unavailable. Raw configuration is not saved in preferences. Native RGBW pixel Preview has not been bench-checked on a physical WLED Light. Strip suggestions fill only missing reported values; the default product is never attached automatically. Preview uses the configured fallback when colour is omitted or brightness is unknown. Saved Segment RGBW colours are sent by Preview and Apply, but Apply is confirmed only when fresh ranges and four-channel colours match. Unset legacy colours require a unique exact-range WLED report. A live RGB-only pixel report cannot prove the white channel. None of these software checks is Hardware Done.

It is early software for a home network. There is no authentication and no TLS. Docker packages the same local/LAN run.

GitHub: [`dylanl321/wled-nightplot`](https://github.com/dylanl321/wled-nightplot) on `main`. The package name is `nightplot-configure`.

## Words

- A **Light** is one enrolled controller and one strip.
- An **Segment** is a contiguous inclusive–exclusive range on that strip.
- **Preview** writes a temporary colour and brightness, then restores (or cancels without restore). Locate hops update that session — they do not take a new snapshot, and they do not claim a `/json/live` report unless one was read.
- **Apply** writes declared ranges (or Strip / Safe fields) and re-reads the controller. Success only when the readback matches.
- **Blink** pulses a Light or a Find candidate so you can see which box it is.
- **All Off** cancels live sessions without restoring, then powers off enrolled Lights.

## How it behaves

- An unreachable Light stays **grey**, with last-seen copy. The rack never shows a stored last colour. If `/json/info` answered but `/json/state` was skipped or hung, power is **unknown** (Online · unknown, unknown-grey beads) — not “Online · off”. Reported segments are **unknown** — not “0 segments”. A known empty `seg` stays 0. Drift is not compared until segments are known — unknown is not an empty report. Apply reread does the same: unknown segments are not treated as empty, and are not a match. Write-failed and reread-failed do not invent an empty `apply.read` — unread stays unknown, not `[]`. Apply leftover-segment clears refuse when the pre-apply count is unknown — they do not invent 0. The failure panel names that unknown refuse — it does not say Apply didn’t stick. A known mismatch still does. Unread / unknown-read captions do not say the controller reported ranges. A known empty reread says **reported no ranges**, not **these ranges**. Its Hardware Done suffix is **until you look at the strip**, not **until you see them**. A known non-empty reread still does. Strip Apply failure uses the same rule: the title is the provision write message (cfg mismatch or refuse), not a hardcoded didn’t-stick. A `buildProvisionWrite` refuse 422 includes `provisionWrite` so that panel is shown — not a notice-only line. Edit ranges rows say **no compare**, not matches, until that report exists. The selected Segment kind chip says **no compare** when that compare is refused — not **seg**. Invert and past strip use the same words as the list row and the bead legend red key — not generic overlap. That red key only appears when invert, past strip, or overlap is present. The dashed drift key only appears when drift is present and compare is meaningful — not when every Segment matches or compare is refused. The v2 Edit-ranges canvas (#2d) legend uses that same gate from the framed scene (this scene has overlap and drift). The keys are not a permanent always-on demo set. An inverted range whose start is already past the strip (80–40 on 60 LEDs) is invert and past strip — not invert only. Overlap and drift still win when those apply. **Use controller’s** on a failed Apply is only offered when that reread named ranges — unknown or empty is disabled and says why.
- RGB vs RGBW on the beads and Inspect chip follows the attached LED product or the persisted strip driver. RGBW shows two dies. `/json/info` `leds.rgbw` is not labeled WS281x RGBW.
- Preview is temporary. Apply is what persists on the controller. Ending Preview writes power, brightness, colour, and ranges only when the last snapshot knew them — an info-only report (info answered, state skipped or hung) does not invent on, brightness 128, `#ffa000`, or a whole-strip segment. First locate with an unknown restore segment count captions that leftover controller segments were not cleared — leftover lights are not this locate and not Applied. Inspect Refresh keeps that unknown leftover caption while the first-locate Preview is open — it does not replace it with a live-read / fixture line. Apply refuses when colour is unknown — it does not write `#ffa000`. Apply refuses as soon as **Light on strip** is on — it does not wait for the first Preview hop.
- Light cards show “Answered Ns ago” from the last controller answer, including cached Online-looking rows; the age updates while the page is visible without probing. A missing answer is unknown, not recent. Unreachable beads stay grey with last-seen copy.
- After a confirmed Segment Apply, Nightplot keeps an independent baseline for that controller. A fresh readback with different known ranges or colour shows a conflict banner on the Light; this is not proof who changed it. Preview/Blink and missing reads never raise one. Replacement and successful Strip hardware changes clear that baseline; inspecting and same-controller readdressing do not.
- All Off cancels without restoring the previous look.
- **Remove this Light** runs checks (Segments, live sessions, controller state). Unknown is not safe; there is no “I understand” override.
- Safe settings and first-time Strip provision write only understood, fingerprinted fields. On a Light’s Settings tab, **Device display name** writes WLED’s name through Safe settings **Apply settings**, not a Nightplot-only alias; only changed fields are sent. The hostname is shown separately beneath the Light title and in Network (with its port), and changing the connection address does not rename the controller. Unsupported firmware is refused — nothing is written. A `buildSafeWrite` refuse 422 includes `safeWrite`. Safe settings shows that as the write-failure panel (Sent / Read back) and hides the notice while it is up — not two identical destructive lines. A GET/load refuse on Safe settings or Strip uses the form banner once — not a second notice and not a doubled caption.
- Settings Power budget is a planning scenario, not live current: set a colour per saved Segment (and RGBW white) plus brightness to estimate up to 20 mA per full channel per LED. It compares to WLED’s reported Safe current limit when available; a disabled/unknown limit is not zero headroom. It excludes uncovered LEDs and electrical losses, controller draw, effects and power-supply ratings. It does not write WLED or prove a strip safe.
- The local WLED-shaped fixture is a software stub for development. A green readback there is not proof that a real strip passed.

After a Safe display-name write, the rack title uses the `/json/cfg` name even when metal `/json/info` still lags until reboot.

**Strip** sets WS281x RGB or SK6812 RGBW type, node count, and GPIO on an enrolled Light. Converting to SK6812 RGBW writes GRBW (`order` 0). A same-type length or GPIO Apply keeps the colour order already on the box, and Strip names that live order — including when an SK6812 bus is not GRBW. There is no colour-order picker. A shared catalog LED product fills that form from the SKU and its driver; this Light’s fields still override. Manage recipes on `/led-products`. Catalog edit mutates the shared recipe only — it does not write WLED. Catalog delete refuses while any Light still attaches that recipe; unknown or partial attach counts are not safe. Attaching a product stores `ledProductId` on the Light and does not write the controller. Attach is not Apply. Apply writes reviewed `/json/cfg` bus fields, then re-reads cfg and the snapshot. A mismatch stays on the failure UI, titled with the write message — not a hardcoded Apply didn’t stick. A length-changing Apply clips or drops declared Segments that run past the new strip, and flags leftover coverage on grow — the UI does not claim they still match.

The LED product catalog is the shared type / IC recipe (SKU, driver, optional defaults, and optional pitch or COB section length). Voltage and other SKU facts stay under Advanced on the recipe. Node count, GPIO, Segment ranges, and field overrides live on that Light. When the attached recipe has a pitch or a section length, the pages show a calculated length (node count times that spacing). That figure is not a tape measurement and it is not written to WLED. Missing spacing leaves the node count alone. Strip-assist plugins (a length helper first; a segment helper can plug in later) are modular help — they do not replace catalog attach. A length helper is not on Strip today. Preview is not Apply. Helper glow is not Hardware Done. The three rules: [docs/overview.md](docs/overview.md#shared-catalog-then-this-light).

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

Store volume: `lights-store` → `/data` (`lights.json`, `settings.json`, `led-products.json`, `activity.json`, `backups/`). `pnpm dev` bind stays loopback; compose publishes `0.0.0.0` on purpose.

GHCR build: Actions → Docker → Run workflow, or push to `main` / a `v*` tag. Images push only when GHCR login succeeds. Workflow does not run on pull requests.

Full build / run / multicast caveats: [docs/deploy.md](docs/deploy.md).

### Discover → Add without a box on the LAN

`pnpm fixture` serves a WLED-shaped `/json` at `127.0.0.1:48210`. Then either:

```bash
pnpm dev:demo
```

or type `127.0.0.1:48210` on Add a Light and **Check and add**. Open the Light on **Segments** to edit ranges on the strip, **Light on strip** (Preview, not Apply), then Save or Apply, or **Settings** for strip hardware, the small Safe set, network facts, and Remove. **All Off** is on the top bar (thumb bar below `lg`). **Remove {name}** on Settings runs three checks and refuses until they complete. The fixture is a software stub for development, not a verified real strip. Unnamed leftover-last writes still apply in array order (`id | it`) the way WLED does — a later leftover `id: 1` `stop: 0` can drop a just-inferred second range. App-test `memoryBox` applies that same order so the collision is visible in server app tests. End Preview restore after locate names restore range ids and posts leftover `stop: 0` first, so that collision is not the production write. Leftover pixels stay until leftover `stop: 0`. That is still a fixture stand-in, not metal.

`pnpm sim` is a separate **external process** (`127.0.0.1:48211`, DDP UDP `4048`) for the enroll → provision → Apply → live/DDP lane. Type `127.0.0.1:48211` on Add a Light. Quiet caption is **software path only**. That is not Hardware Done. Three Done layers stay distinct: fixture → sim/e2e → metal (human benches). `pnpm test` spawns the sim.

By default the fixture updates `/json/info` and `/json/cfg` together. Real metal often keeps the old `/json/info` name until reboot. To simulate that lag: `NIGHTPLOT_FIXTURE_INFO_NAME_LAG=1 pnpm fixture`, or `POST http://127.0.0.1:48210/nightplot/info-name-lag` with `{ "on": true }`. Safe settings rename still updates the rack title from cfg. `{ "on": false }` copies cfg → info. `NIGHTPLOT_FIXTURE_NATIVE_TYPE=30` starts the fixture bus as SK6812 RGBW; default is 22 (WS281x RGB). Enroll keeps the default driver until Inspect or Strip reads cfg. A fixture readback is still a development stub.

**Ports.** Find uses a real advertised port: SSDP `LOCATION`, mDNS SRV. It does not assume `:80`. A host with no port from find is listed as needs host:port — it is not Add-able. Typed address is the escape hatch (a typed host with no port still means `:80`). Listed hosts use `displayHost` and hide default `:80` (a not-WLED reject on port 80 is `192.168.1.80`, not `192.168.1.80:80`). The fixture is **not** on 80; type `127.0.0.1:48210` or use the demo target list.

Enrolled Lights and declared Segments persist in `data/lights.json` (override with `NIGHTPLOT_STORE_PATH`). Operator LED products persist in `data/led-products.json` (override with `NIGHTPLOT_LED_PRODUCTS_PATH`) and are managed on `/led-products`. Find sends mDNS and SSDP on each IPv4 that is not loopback and not `169.254.0.0/16`. The shell starts that scan while Nightplot is open and retries about once a minute while the tab is visible. **Find Lights** runs it again. mDNS rows are `_wled._tcp` answers. Find Lights also probes `NIGHTPLOT_DISCOVERY_TARGETS` (comma-separated `host` / `host:port` — include the port when it is not 80). Find probes up to **four** collected hosts at a time; a dead probe aborts in about 3 s and does not block the rest of the scan. All Off probes up to **four** enrolled Lights at a time the same way — a dead Light does not hold the rest of the rack, and each Light is listed by what it reported (unknown stays unknown). After `/json/info` answers, `/json/state` is a short enrichment — a hang does not add another 3 s. Identity and `ledCount` stay; `on` stays unknown (Online · unknown, unknown-grey beads), not “Online · off”. The listed reason uses the time that actually elapsed, or generic **probe failed** when the refuse was instant. **All Off** unknown rows use that same honesty with All Off wording: the wait that happened, or generic **no answer from {host}.** — not a claimed 3 s. **Delete** unknown controller copy uses the same gate: the wait that happened, or generic **Couldn’t read it** — not “in time”.

## Docs

| Doc | What |
| --- | --- |
| [docs/overview.md](docs/overview.md) | What Configure is, enroll-then-assign, and how the flow works |
| [docs/install.md](docs/install.md) | Install, env, fixture, sim / e2e, proto |
| [docs/deploy.md](docs/deploy.md) | Docker / compose / GHCR on a LAN |
| [docs/architecture.md](docs/architecture.md) | Real paths and symbols |
| [docs/ui/README.md](docs/ui/README.md) | Bead language; the running shell is the v3 top bar |
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
| GET | `/api/catalogs` | Controller / strip / discovery seams, named strip presets (`stripPresets`), operator LED products (`ledProducts`). Shared recipes — not a per-Light bus write. |
| GET | `/api/led-products` | Nightplot LED product catalog (seeded SKUs + operator creates). Shared type / IC recipe. Does not write WLED. |
| GET | `/api/led-products/:id` | One catalog row. 404 if missing. |
| POST | `/api/led-products` | Create a product. 422 on unknown `driverId`, bad `formFactor`, or bad defaults. Does not write WLED. |
| PATCH | `/api/led-products/:id` | Replace a catalog recipe (SKU / driver / defaults; id stays). Same validation as POST. Does not write WLED. Does not invent this Light’s length, GPIO, or ranges. Not Apply. |
| GET | `/api/led-products/:id/delete-checks` | Lights-attach check. Unknown or partial refs are not zero and are not safe. Does not write WLED. |
| DELETE | `/api/led-products/:id` | Remove a catalog recipe. 409 while any Light still attaches that `ledProductId`. 422 when the attach count is unknown or partial. No override. Does not write WLED. Not Apply. |
| GET | `/api/lights` | Saved Lights and Segments, last-seen state, unenrolled tray. No controller probe or store write; beads are grey without a current snapshot. Inspect and live Refresh probe one Light. |
| GET | `/api/activity?lightId=…` | Saved Activity (newest first; optional Light filter): Apply readback, Preview start/end, per-Light All Off results, and controller replacement boundaries. `match` is controller/software readback, not Hardware Done. |
| GET/POST | `/api/backups` | List saved backup summaries / create a versioned Nightplot data snapshot. Stored locally beside the Lights store (override with `NIGHTPLOT_BACKUPS_PATH`); up to 100, no silent pruning. |
| POST | `/api/lights/:id/backups` | Capture both native WLED `cfg.json` and `presets.json` plus Nightplot data for one online Light. The Backups page can download each native file. WLED excludes passwords; keep exports private. |
| GET/DELETE | `/api/backups/:id` | Inspect/download the JSON backup / clear that exact backup with `{ confirmId }`. Clearing cannot be undone without a downloaded copy. |
| POST | `/api/backups/:id/restore/check` | Validate backup and compare counts/digests with current Nightplot data. No writes. |
| POST | `/api/backups/:id/restore` | `{ confirmId, expectedDigest, expectedCurrentDigest }` — refuse stale review or active Preview/Blink, create a safety backup, restore only Nightplot data; never write WLED. |
| GET | `/api/lights/:id` | Inspect payload: identity, declared Segments, reported segments, drift, live session. When `stripKind` is still the default and no LED product is attached, a live Inspect may persist a known `/json/cfg` bus type. An open first-locate Preview with unknown restore segment count keeps that leftover caption — Inspect does not replace it with a live-read / fixture line. |
| GET | `/api/lights/:id` health | Live `/json/info` uptime (seconds), Wi-Fi signal/RSSI and free memory accompany a current Light detail; unknown/unreachable readings are not filled from stale data. Settings warns on pre-0.14 Strip firmware and distinguishes unverified versions from too-old ones. |
| GET | `/api/lights/:id/segments/backup` | Download a versioned JSON backup of this Light's saved Segments, without probing the controller. Unsaved edits are not included. |
| POST | `/api/lights/:id/segments/restore` | `{ backup, confirmDifferentController? }` — validate and replace Nightplot's saved Segments. Refuses a different LED count or active Preview/Blink, and needs confirmation for a different controller. Does not probe, Preview, or Apply. |
| POST | `/api/lights/:id/replacement/check` | `{ host }` — probe a new WLED controller and review its MAC, address, LED count, and preserved Segment count. No store or WLED write. |
| POST | `/api/lights/:id/replacement` | `{ host, confirm: true, expectedHostKey, expectedMac, previousHostKey, previousMac }` — re-probe and replace the controller on this Light only if identity and length still match the check. Saved Segments stay; old snapshot is cleared. No WLED write or Apply. |
| GET | `/api/lights/:id/live` | Same Light plus current `/json/live` beads. First-locate unknown leftover caption is kept the same way as Inspect. |
| PATCH | `/api/lights/:id/elements` | Save declared ranges. 422 on invert / overlap / over-ledCount. Does not write WLED. |
| POST | `/api/lights/:id/apply` | Write declared ranges, re-read snapshot. 200 only on match. 409 keeps the failure. Unknown reread segments are not an empty match. Unknown colour refuses (422) — Apply does not invent `#ffa000`. Unknown pre-apply segment count refuses leftover-segment clears (422). |
| POST | `/api/lights/:id/readdress` | `{ host }` — probe first, same-MAC continuity, persist address + last-good snapshot. |
| POST | `/api/lights/:id/preview` | Temporary colour. A Segment id paints that one segment (Blink uses this). `{ start, stop, color }` lights that span and blacks the rest. `{ spans: [{ start, stop, color }] }` lights each span and blacks the rest, so Segments can stay lit while one LED is marked. Locate hops write one black underlay plus merged lit pieces; when only the cursor LED moved, HTTP posts that one segment (`tt: 0`) instead of rebuilding `seg[]`. A gap cursor between Segments reuses overlay ids for unchanged start/stop/col so later Segments are not rewritten. First locate open `stop: 0`s leftover controller ids above the overlay picture when the snapshot count is known and higher. Unknown restore segment count captions that leftovers were not cleared and refuses clear-as-success — it does not invent a leftover count. Soft overlay write may still go. Inspect / Light refresh keeps that unknown leftover caption while the first-locate Preview is open. Leaving overlay for a named-Segment or Blink Preview clears leftover overlay ids we authored (`stop: 0`). End Preview restore after overlay also `stop: 0`s leftover overlay ids we authored — it does not invent a leftover count or restore ranges. A later hop on an open session does not re-snapshot restore and does not probe the Light again. Locate hops skip `/json/live` unless `{ reread: true }`. Equal write pictures are not POSTed again. `reported` stays range rails; match counts are `liveMatch` — omitted when the hop did not read. |
| POST | `/api/lights/:id/preview/end` | Restore previous look (`restore: false` cancels without restore). After a locate overlay, leftover overlay ids we authored get `stop: 0`. Preview is not Apply. |
| POST | `/api/lights/:id/preview/seen` | Person rung: `{ seen: "yes" \| "no" }`. Not Hardware Done. |
| POST | `/api/lights/:id/blink` | Identify pulse. Same `reported` / `liveMatch` contract as Preview. Restore with `/blink/end` (UI does this after 3 s). |
| POST | `/api/discover/blink` | `{ host }` — pulse a candidate, then restore. |
| POST | `/api/discover` | LAN find (mDNS, SSDP, env targets). Probes up to four collected hosts at a time. Does not enroll. |
| GET | `/api/discover` | Last find/probe rows |
| POST | `/api/discover/probe` | `{ host }` — one address. Public IPs refused before HTTP. |
| POST | `/api/lights` | `{ host }` — enroll. Fails closed without a WLED snapshot. Duplicate host → 409. |
| POST | `/api/apply` | 400 — use `/api/lights/:id/apply` |
| POST | `/api/all-off` | Cancel live sessions without restore, then `{ on: false }` each enrolled Light (up to four Light probes at a time; fail-closed per Light). Body `{ lightIds }` retries only those. |
| GET | `/api/lights/:id/delete-checks` | Segments / live sessions / controller state. Unknown is not safe. |
| DELETE | `/api/lights/:id` | 422 until every check is `ok`. Does not write the controller. |
| GET | `/api/lights/:id/safe` | Fingerprinted Safe settings from `/json/cfg`. Empty fingerprint → refuse. |
| POST | `/api/lights/:id/safe` | `{ settings }` — write only understood fields, then reread. 422 if unsupported — refuse includes `safeWrite` (Safe settings failure panel, notice hidden). A matched display-name write patches the enrolled title from cfg even when `/json/info` still lags. |
| PATCH | `/api/lights/:id/led-product` | `{ ledProductId }` — attach a shared catalog product or `null` for manual fields. Persists on the Light. Nightplot bookkeeping — not Apply, not a WLED write. |
| GET | `/api/lights/:id/provision` | First-time strip bus from `/json/cfg` (`hw.led.ins[0]`). Empty / multi-bus / unsupported firmware → refuse. |
| POST | `/api/lights/:id/provision` | `{ provision: { ledType, length, gpio } }` — `ws281x` or `sk6812-rgbw`. Writes reviewed cfg bus fields, then rereads cfg and snapshot. 200 only on match. 409 keeps the failure. 422 if unsupported — refuse includes `provisionWrite` (Strip failure panel, not notice-only). Unknown types are not written. A successful length change reconciles declared Segments (clip / drop / flag leftover coverage) and returns `provisionWrite.ranges`. |

## UI

| Path | What |
| --- | --- |
| `/` | Lights cards + found banner. All Off on the top bar / thumb bar |
| `/led-products` | Shared LED product catalog — list / create / edit / delete recipes (LED type / IC, pitch or COB section length). Voltage and similar facts are under Advanced. Delete refuses while Lights still attach that recipe; unknown or partial attach counts are not safe. Node count, GPIO, and ranges stay on each Light. A catalog-only load miss keeps enrolled Lights; it does not claim the configure server is down. |
| `/discover` | Find starts on its own while this page is open. Find Lights retries that scan. Type an address to add. A Find load miss still lists enrolled Lights; it does not claim the configure server is down. |
| `/lights/:id` | Segments (`?tab=elements`, the default) — edit ranges on the strip (drag, cut, combine). **Light on strip** is Preview. Hover and drag hops coalesce (latest LED, skip a no-op); the Light page does not refresh its beads on every hop. Apply is refused as soon as Show is on. **Cursor only** lights the focused cursor or LED selection and blacks the rest. Click a Segment or edge to make it the arrow-key focus; hover only moves the cursor in Locate. **Segments stay lit** keeps every Segment visible and marks a bright cursor inside Segments and gaps. Segment brightness defaults to 35% and adjusts independently of the cursor. A fixed pixel canvas avoids rebuilding controller ranges during movement. The strip card includes contextual key hints, 31-LED Zoom, and compact cursor/Scan controls. Mark start / Mark end opens selection options; N creates a Segment. Touching edges resize together, with Alt / ⌥ to detach, and consecutive arrows share one Undo step. See [Edit and locate Segments](docs/segment-locate.md). Beads match that picture. The banner above the strip compares this draft with the last controller report; dragging changes the draft, and Apply is what changes the controller. Save and Save & Apply stay refused while a range is inverted, overlapping, or past the strip. Settings (`?tab=settings`) — strip hardware, Safe settings, network, Remove. Old `?mode=ranges` and `?mode=live` open Segments; `?mode=inspect`, `?mode=strip`, and `?mode=safe` open Settings. A detail load miss still lists enrolled Lights; it does not claim the configure server is down. Preview is not Apply. |
| `/lights/:id?tab=settings` | Strip hardware — attach a shared catalog recipe or set this Light’s WS281x / SK6812 RGBW plus length / GPIO; this Light’s fields still override. Attach is bookkeeping. **Apply hardware** writes `/json/cfg` then re-reads. Mismatch or refuse stays (`provisionWrite` on 409 / 422). Controller — name, boot, transition, current limit; **Apply settings**; refuse 422 includes `safeWrite`. Network — last snapshot address, MAC, firmware. Remove stays open, runs three checks, and stays disabled until they complete. |

## Layout

| Path | What |
| --- | --- |
| `apps/web` | Quiet-utility top bar, Lights cards, Discover, LED product catalog, Segments, Settings, All Off, Remove, `StripBeads` |
| `apps/server` | Discover/connect, JSON Light store, LED product catalog, WLED snapshot + live + Apply + Strip provision + All Off + Delete + Safe settings + fixture |
| `packages/shared` | LAN guard, WLED parse, catalogs, Light / Segment types |
| `docs/ui/` | Bead-language prototype. The running shell is the v3 top bar. See [docs/ui/README.md](docs/ui/README.md). |
| `docs/PLANE.md` | CONFIG tickets, REST-only Plane duties. |
| `Dockerfile` / `docker-compose.yml` | Local/LAN image + compose. See [docs/deploy.md](docs/deploy.md). |

## Prototype

```bash
pnpm proto
```

Then open [http://127.0.0.1:43182/Nightplot%20Configure%20v2.dc.html](http://127.0.0.1:43182/Nightplot%20Configure%20v2.dc.html).

Plane project: Configure (`CONFIG`) in workspace `nightplot`. See [docs/PLANE.md](docs/PLANE.md).
