# Architecture

One code basis. New controllers or strip types register a catalog member; they do not fork the Lights / Elements / live stack.

This is early software. Paths below are the real tree on `main`.

## Layout

| Path | Package | Role |
| --- | --- | --- |
| `apps/web` | `@nightplot/web` | Quiet-utility Next.js shell. Routes: `/`, `/discover`, `/led-products`, `/backups`, `/lights/[id]` |
| `apps/server` | `@nightplot/server` | Hono API, Discover, JSON store, WLED I/O, fixture, headless sim |
| `packages/shared` | `@nightplot/shared` | Types, catalogs, LAN guard, parse, range / live / safe / provision |
| `docs/ui/` | — | v2 prototype (visual source of truth) |

Web talks to the API by rewrite: `/api/:path*` and `/health` → `NIGHTPLOT_API_URL` (default `http://127.0.0.1:43181`). Browser fetches use same-origin paths (`apps/web/src/lib/api.ts`). Add a Light (`/discover`) loads `GET /api/lights` and `GET /api/discover` independently: a Find miss keeps enrolled Lights and does not render ServerDown; a Lights miss still does. Inspect (`/lights/:id`) loads `GET /api/lights` and `GET /api/lights/:id` the same way: a detail miss keeps enrolled Lights; a Lights miss still uses ServerDown. LED products (`/led-products`) loads `GET /api/lights` and `GET /api/led-products` the same way: a catalog miss keeps enrolled Lights; a Lights miss still uses ServerDown. Backups (`/backups`) loads `GET /api/lights` and `GET /api/backups` the same way: a backups miss keeps enrolled Lights; a Lights miss still uses ServerDown.

## Catalog seams

First members. Home directories are the registration point.

| Seam | First member | Home | Notes |
| --- | --- | --- | --- |
| Controller | WLED | `packages/shared/src/controller/` | `wledController` — `wired: true`, capabilities through provision |
| Strip / driver | WS281x, SK6812 RGBW | `packages/shared/src/strip/` | `ws281xStrip` + `sk6812RgbwStrip` — both `wired: false`. Pixels go through WLED, not a local driver |
| Discovery | mDNS / SSDP / address probe | `packages/shared/src/discovery/` | `implementation: "registered"`. Empty results are honest |

`GET /api/catalogs` returns `catalogSnapshot()` (`packages/shared/src/catalog.ts`). `CURRENT_SLICE` is `"R6"`. Named strip presets live in `packages/shared/src/strip/presets.ts` (`stripPresets` on that payload) and seed the LED product catalog. Operator LED products (`LedProduct`) live in `packages/shared/src/strip/products.ts` and on that payload as `ledProducts`. `GET`/`POST`/`PATCH`/`DELETE /api/led-products` manage the catalog (`FileLedProductsStore.update` / `remove`). `DELETE /api/led-products/:id` refuses while any Light still attaches that `ledProductId`. Unknown or partial attach counts are not zero and are not safe. `PATCH /api/lights/:id/led-product` attaches one to a Light (`ledProductId`). That is Nightplot bookkeeping, not a WLED write.

`registered` means the slot exists. It is not proof hardware passed. `ControllerDescriptor.implementation` / `wired` / `capabilities` stay honest (`packages/shared/src/controller/types.ts`).

## Shared catalog vs this Light

The seams above register controller, strip-driver, and discovery members. Operator LED products sit on the strip-driver catalog: they are shared recipes, not per-Light bus writes. Product language: [overview.md](overview.md#shared-catalog-then-this-light).

| Layer | What it owns | Home |
| --- | --- | --- |
| Strip / driver | IC recipe: channels, colour order, bead | `packages/shared/src/strip/catalog.ts` (`ws281x`, `sk6812-rgbw`) |
| LED product | Shared SKU: `driverId`, form factor, optional defaults, pitch or COB section length, Advanced facts | `packages/shared/src/strip/products.ts`, `apps/server/src/store/led-products-store.ts`, `data/led-products.json`, `/led-products` |
| This Light | `ledProductId`, node count / GPIO / type overrides, Element ranges, calculated length when the recipe has spacing | `packages/shared/src/lights.ts`, `data/lights.json`, Strip |

Controller and discovery catalogs stay their own seams (`packages/shared/src/controller/`, `packages/shared/src/discovery/`). They do not replace the LED product catalog.

Attach (`PATCH /api/lights/:id/led-product`) stores the catalog id on the Light. That is not Apply. Catalog edit (`PATCH /api/led-products/:id`) mutates the shared recipe only — it does not write WLED. Catalog delete (`DELETE /api/led-products/:id`) removes the recipe only when no Light attaches it; unknown or partial refs refuse, and there is no override. That is not Apply and not Hardware Done. Strip Apply (`POST /api/lights/:id/provision`) writes that Light’s type / length / GPIO. Helpers that suggest a length — or later a segment — are Strip-assist plugins: they do not own the catalog and they do not replace attach. No assist plugin is registered today. Preview is not Apply. Helper glow is not Hardware Done.

Routes and API: [README.md](../README.md#ui) / [README.md](../README.md#api).

## Domain types

| Symbol | File | Meaning |
| --- | --- | --- |
| `Light` | `packages/shared/src/lights.ts` | One enrolled controller + one strip. `ledProductId` is a catalog attach (null = manual fields) |
| `Element` | same | Inclusive–exclusive range on that strip |
| `validateDeclaredRanges` | `packages/shared/src/range.ts` | Invert, overlap, `over-ledCount`. Start at or past `ledCount` (or stop below 0) is past strip even when inverted |
| `BeadColor` | `packages/shared/src/bead.ts` | Colour, `null` (off), or `"unknown"` (grey) |
| `stripHonestyForLight` | `packages/shared/src/strip/honesty.ts` | rgb / rgbw + chip caption from product, else `stripKind` |
| `WledSnapshot` | `packages/shared/src/wled/snapshot.ts` | Parsed `/json` (info + state) |
| `WledSafeSettings` | `packages/shared/src/safe.ts` | Small Safe set; fingerprint-gated |
| `WledStripProvision` | `packages/shared/src/provision.ts` | First-time bus: type / length / GPIO plus live `nativeOrder` / `colorOrder`. `buildProvisionWrite` authors `order: 0` (GRBW / `COL_ORDER_GRB` on RGBW) only on native type change; same-type length / GPIO clones the live `order` |
| `LedProduct` | `packages/shared/src/strip/products.ts` | Operator LED SKU. `formFactor` is metadata. `driverId` must be a registered strip driver |

Unreachable: `markUnreachable` in `apps/server/src/domain.ts` clears `on` / `brightness`. `beadFor` returns `"unknown"` — never a stored last colour. An info-only snapshot (skipped or hung `/json/state`) keeps `on: null` and `segments: null`. Power unknown is not off: Lights / Inspect say **Online · unknown**, and `beadForReportedOn` paints unknown-grey. Known `on: false` stays **Online · off**. Missing segments are not zero: `segmentCount` is null (**segments unknown**). A known empty `seg: []` stays **0 segments**. Drift compare skips when `segments` is `null` — it does not treat unknown as `[]`. Apply reread skips `applyOutcome` when `segments` is `null` (`applyUnknownSegments`) — unknown is not an empty match. A known empty list still compares as empty. Write-failed and reread-failed set `apply.read` to `null` (`applyUnreadFailed`) — they do not invent a known empty `[]`. `applyCaption` follows that read: unread / unknown-read does not say the controller reported ranges. A known empty reread says **reported no ranges**, not **these ranges**. Its Hardware Done suffix is **until you look at the strip**, not **until you see them**. A known non-empty reread still does. Apply leftover-segment clears use `snapshotSegmentCount` — unknown is not `0` and does not author `stop: 0` leftovers. Apply refuses that write until the count is known. Edit-ranges `ApplyFailed` shows `apply.message` (unknown-reread refuse ≠ didn’t-stick). Edit ranges rows use that same refuse (**no compare**) — they do not say matches until a report exists. The selected-Element kind chip uses it too — it does not say **seg** until a report exists. Invert and past strip use the same words as the list row and the bead legend red key — not generic overlap. That red key only appears when invert, past strip, or overlap is present. The dashed drift key only appears when drift is present and compare is meaningful — not when every Element matches or compare is refused. The v2 Edit-ranges canvas (#2d) legend uses that same gate from the framed scene (this scene has overlap and drift). The keys are not a permanent always-on demo set. `validateDeclaredRanges` names `over-ledCount` when an inverted range’s start is already past the strip (80–40 on 60 LEDs) — invert only is not enough. Combined invert copy names past strip when both apply. Overlap and drift still win when those apply. Preview restore omits `seg` when `segments` is `null` — it does not invent a whole-strip write from colour. ApplyFailed **Use controller’s** adopts `apply.read` only when that list is known and non-empty (`adoptableControllerRanges`); unknown or empty disables the action and names why.

`Light.rgbw` is the last `/json/info` `leds.rgbw`. Inspect and Lights beads use `LightView.stripBead` / `stripChip` from `stripHonestyForLight` (attached `LedProduct`, else persisted `stripKind`). A successful Strip cfg read or Apply stores a known `ledType` on `stripKind`. A live Inspect GET may also read `/json/cfg` once when `stripKind` is still the default and `ledProductId` is null, then persist a known mapped `ledType`. The Lights list does not GET cfg. Snapshot rgbw is not a driver name.

Strip Apply (`buildProvisionWrite`) writes WLED `order: 0` (GRBW on SK6812 RGBW; `COL_ORDER_GRB`) only when the native bus type changes — convert, including unknown → mapped. A length or GPIO Apply that keeps the same type leaves the colour order already on the box. Strip names that live/preserved order after Apply (and on the cfg read). A non-GRBW SK6812 order is said out loud — not a blank. The Strip form does not pick colour order. Extra mapping rows are not registered. The Strip failure panel titles from `provisionWrite.message` (cfg mismatch / refuse ≠ didn’t-stick). A `buildProvisionWrite` refuse 422 includes `provisionWrite` — same as `provisionRefuseReason` — so that panel is shown, not a notice-only line. A `buildSafeWrite` refuse 422 includes `safeWrite` — same as `safeRefuseReason`. Safe settings titles the failure panel from `safeWrite.message` (Sent / Read back) and hides the notice while that panel is up. A GET/load refuse uses the form banner once — notice is not set from `safe.refuse` or `provision.refuse`, and the caption is not repeated under the form. Fixture software-green is not Hardware Done. Preview is not Apply.

## Server

`createApp` in `apps/server/src/app.ts` is the rack. Boot: `apps/server/src/index.ts`.

| Piece | Symbol | File |
| --- | --- | --- |
| HTTP | `createApp` | `apps/server/src/app.ts` |
| Store | `FileLightsStore` | `apps/server/src/store/lights-store.ts` |
| LED products | `FileLedProductsStore` | `apps/server/src/store/led-products-store.ts` |
| Backups | `FileBackupStore` | `apps/server/src/store/backup-store.ts` |
| Probe | `createWledProbe` | `apps/server/src/wled/client.ts` (`TIMEOUT_MS` 3000). All Off unknown-row copy is `allOffNoAnswerReason` — elapsed or generic refuse, not a claimed 3 s. Delete unknown-controller copy is `deleteUnknownControllerReason` — elapsed or generic refuse, not “in time” |
| Live write / `/json/live` | `createWledWriter`, `createWledLiveReader`, `restoreOnField`, `restoreBriField`, `restoreColField`, `restoreSegField`, `applyRangesWrite`, `writeBodiesEqual`, `overlayLocatePicture`, `stabilizeLocateOverlayIds`, `firstLocateWrite`, `locateHopWrite`, `previewWriteLeavingOverlay`, `restoreWriteLeavingOverlay` | `apps/server/src/wled/live.ts`. Preview / Blink restore omits `on` / `bri` / `seg` / segment `col` when the snapshot did not know them — never `null → true`, `null → 128`, `null → #ffa000`, or `null →` a whole-strip segment from colour. Known empty `seg: []` restores as empty. End Preview restore after a locate overlay posts leftover overlay `stop: 0` first for ids we authored, then named restore range ids `0…n` — it does not invent a leftover count or restore ranges, and leftover `id: 1` does not drop a second restore range. Apply leftover-segment clears refuse when `snapshotSegmentCount` is unknown — never `null → 0`. Apply refuses unknown colour (`applyRefuseReason` / `knownApplyColor`) — never `null → #ffa000`. Locate Preview uses one black underlay plus merged lit pieces (`tt: 0`); a hop that only moved the cursor POSTs that one segment. Adjacent same-colour merge stays. Hops reuse previous overlay ids when start/stop/col match (`stabilizeLocateOverlayIds`) so a gap cursor does not remap later lit ids. First locate open posts leftover controller `stop: 0` for ids above the overlay picture when the snapshot count is known and higher. Unknown restore segment count is a soft overlay write plus an honest unknown caption — leftover clears refuse (`unknown-segment-count`), never an invented leftover count, never leftover lights as this locate / Applied. Inspect `decorateDetail` / Light refresh keeps that first-locate unknown leftover `liveCaption` while the Preview session is open — it does not replace it with a live-read / fixture line. Leaving overlay for a named-Element or Blink Preview posts leftover overlay `stop: 0` for ids we authored. HTTP `/json/state` only — not UDP. Preview is not Apply. |
| Elements locate (client) | `useLiveLocate`, `locateFrame` | `apps/web/src/components/elements-editor/use-live-locate.ts`. **Light on strip** posts Preview hops latest-wins: superseded hover/drag frames drop while a hop is in flight; identical start/stop/color or spans are not posted again; the first frame sends immediately and subsequent sends keep a fixed 50 ms minimum interval, even during continuous movement. Failed, timed-out, or incomplete responses pause until explicit retry. Only acknowledged frames deduplicate. One editor orders its pending request, End Preview, and restart; Apply stays refused while ending. Old or unmounted senders never update another Light. Opening/end requests time out after 15 s and subsequent hops after 5 s; aborting a client request does not cancel server work. This is client-local ordering, not cross-tab/server ownership. **Segments stay lit** dims Segment colors on the fixed pixel canvas and marks the focused cursor inside Segments and gaps. The editor separates hover from focus except in Locate. Its reducer routes arrows to the cursor, selection, Segment, or edge; shared edges use the same operation for drag and keyboard movement. **Cursor only** stays one target. Locate hops do not refresh LightDetail / beads every time — the strip caption can still update. Apply is refused as soon as the toggle is on — it does not wait for the first hop session. Preview is not Apply. tip/sim/e2e is not Hardware Done. |
| cfg | `createWledCfgReader`, `createWledCfgWriter` | `apps/server/src/wled/cfg.ts` |
| Live sessions | `createLiveEngine` | `apps/server/src/live/engine.ts`. An open Preview session updates paint without re-deriving restore from a new snapshot. Equal write pictures short-circuit (no POST). First locate POSTs `firstLocateWrite` leftover controller `stop: 0` from the known restore snapshot count. Unknown count still posts the overlay picture (`firstLocateWrite(null)` body) and captions that leftovers were not cleared — not clear-as-success. The open session keeps `leftoverClears: "unknown"` so Inspect `decorateDetail` / Light refresh recomputes that caption instead of a live-read / fixture line. Later locate hops POST `locateHopWrite` (the moved cursor segment when that is all that changed — including a gap cursor that must not remap later Element ids) and skip `/json/live` unless `{ reread: true }`. A skipped read is not a report and not Apply. Leaving overlay for a named-Element or Blink Preview POSTs leftover overlay `stop: 0` for ids from the last overlay write. End Preview restores known fields only, and after overlay `stop: 0`s leftover overlay ids we authored first, then named restore range ids. |
| Find collect | `createCollector` | `apps/server/src/discovery/collect.ts` |
| Find probe bound | `FIND_PROBE_CONCURRENCY` (4) | `apps/server/src/discovery/map-limit.ts` |
| All Off Light bound | `ALL_OFF_PROBE_CONCURRENCY` (4), `mapLimitSettled` | `apps/server/src/discovery/map-limit.ts` |
| Fixture | `createFixtureBox` (`kind: "fixture"`) | `apps/server/src/wled-fixture-box.ts` — in-process / `pnpm fixture`. Unnamed writes infer omitted `id` from array order (`id | it`) and apply leftover `stop: 0` in that same order — a later leftover `id: 1` can drop a just-inferred second range (WLED-shaped). App-test `memoryBox` uses that same apply order (CONFIG-148) so End Preview multi-range + leftover regression is visible there too — leftover pre-pass before unnamed apply was the test-double gap. Production End Preview restore names restore ids and leftover-first so that collision is not the write. Unmentioned leftover overlay ids stay. Leftover pixels stay until leftover `stop: 0`. Production leftover `stop: 0` is still the stand-in that clears them. Fixture software-green is not Hardware Done. |
| Sim / e2e | `pnpm sim` / `spawnWledSim` | `apps/server/src/wled-sim.ts`, `wled-sim-spawn.ts`, `wled-ddp.ts` — external process, DDP UDP. Quiet caption **software path only** |

`GET /health` returns `{ ok, service: "nightplot-configure", slice: CURRENT_SLICE }`.

`GET /api/lights` builds rows from saved Lights, Segments, and last-seen fields only; it does not probe or write the store. Without a current snapshot, list beads are grey and controller Segment counts are unknown, including for a previously online Light. Inspect (`GET /api/lights/:id`) and explicit live Refresh (`GET /api/lights/:id/live`) still probe one Light and update its saved reachability. The Lights list component does not start its own probes.

## LAN guard

`decideProbeAddress` / `isLanAllowed` / `displayHost` / `parseHostPort` live in `packages/shared/src/net/address.ts`. Public addresses are `disallowed-address` before HTTP. See [SECURITY.md](../SECURITY.md).

Find must use an advertised port (SSDP `LOCATION` in `apps/server/src/discovery/parse.ts`, mDNS SRV) or list the row as needs host:port. Typed host with no port still means `:80`.

## Persistence

`FileLightsStore` writes `{ version: 1, lights, elements }` to `data/lights.json` (or `NIGHTPLOT_STORE_PATH`). A Light may carry `ledProductId` (null if the operator keeps manual Strip fields). `FileLedProductsStore` writes `{ version: 1, products }` to `data/led-products.json` (or `NIGHTPLOT_LED_PRODUCTS_PATH`). First boot seeds from `STRIP_PRESETS`. Neither file is a WLED write.

`FileActivityStore` writes `{ version: 1, entries }` atomically to `data/activity.json` beside the Lights store (or `NIGHTPLOT_ACTIVITY_PATH`). The latest 1000 entries survive server restarts and appear newest first on a Light's Activity tab. Apply logs controller readback match/difference/unknown after a write attempt; Preview logs its initial start and end (not every cursor hop), with restore write acceptance explicitly distinct from pixel verification. All Off logs each targeted Light and Preview cancellation without restoration. A controller/software readback match is not Hardware Done.

Replacement checks a new WLED address/MAC and LED count without writing, then re-probes on explicit confirmation. The same Light ID and saved Segments remain; the old controller's snapshot is cleared and Activity marks the identity boundary. An already-enrolled address or MAC, active Preview/Blink, different LED count, or identity change during confirmation refuses. Replacement does not copy controller settings or Apply ranges. Same-MAC Change address remains a distinct path.

`FileBackupStore` keeps versioned JSON documents in `data/backups/` (override `NIGHTPLOT_BACKUPS_PATH`) on the same persistent volume as Lights; its 100-file limit refuses new captures rather than silently deleting history. Each contains Lights, Segments, LED products, Activity, optional reference-only WLED fields, and optional native `/cfg.json` + `/presets.json` texts with Light identity, MAC, firmware and capture time. Raw `/json/cfg` is not a device backup. Backups UI can view/download/clear an exact id. Nightplot restore validates all three stores, compares digests from review, blocks active Preview/Blink, writes a pre-restore safety backup, then stages the three JSON files and renames them after a ready intent (`.nightplot-restore-intent.json`). A crash after that intent is finished on the next API boot. Restore does not Apply and does not upload WLED files.

WLED-native captures GET `/cfg.json` and `/presets.json` from the enrolled host:port, verify each is a bounded JSON object, strip leftover passwords if WLED included any, and store both file texts with identity metadata. A missing/error/HTML file refuses the required pre-Apply/Strip/Safe write. Replacement tries a native capture of the departing controller when it answers, and still saves Nightplot data with an incomplete device section when it does not. The Backups page downloads the two WLED exports separately. Uploading them is a distinct `restore-wled` path: MAC must match, firmware mismatch needs an extra confirm, a fresh native+Nightplot safety backup is required, then POST `/upload` sends presets and configuration. The box typically reboots after configuration restore. Passwords are not restored. This is not Hardware Done. Fixture endpoints are software stubs.

Light Settings health is derived only from the current `/json/info` snapshot (uptime seconds, Wi-Fi signal/RSSI and free heap bytes). Missing values stay null and unreachable Lights never reuse cached health as current. Compatibility messaging uses the Strip provision firmware table: versions older than its 0.14.0 baseline warn as too old; other unlisted versions are unverified, not declared too old. No health reading proves a physical strip is lit.

Power budget uses a pure shared per-Segment scenario model: saved exclusive ranges, user-selected RGB (plus RGBW white), 0–255 brightness, 20 mA maximum per full channel. It refuses invalid/overlapping ranges and unsupported drivers. Settings reads the live `/json/cfg` Safe current limit for a comparison; `maxpwr: 0` means the WLED limiter is disabled, not a 0 mA ceiling. Uncovered LEDs are excluded. This is neither the actual live draw nor a supply/wiring/fuse calculation, and it does not send a WLED write.

## Stubs / NYI (honest)

| Thing | Status |
| --- | --- |
| Docker / compose / GHCR | Image + compose for local/LAN run. See [deploy.md](deploy.md). No auth or TLS |
| Local strip driver | Catalog members registered (WS281x, SK6812 RGBW); `wired: false` |
| Auth / public bind | Not present. Defaults loopback. Containers bind `0.0.0.0` for published ports — LAN publish, not a public-internet deploy |
| Hardware Done | Not claimed. Three layers stay distinct: fixture (in-process) → sim/e2e (external process) → metal (human benches). Fixture software-green and sim **software path only** are not Hardware Done |

API routes: [README.md](../README.md#api). UI routes: [README.md](../README.md#ui).

## Three Done layers

These are not the same proof.

| Layer | Process | Caption | What it can claim |
| --- | --- | --- | --- |
| Fixture | In-process `createFixtureBox` / `pnpm fixture` | Software-green from the fixture | Route and honesty unit tests passed |
| Sim / e2e | External `pnpm sim` / CI spawn | Software path only | Enroll → provision → Apply → live/DDP against HTTP+/DDP |
| Metal | Real WLED + strip (CONFIG-26) | Human benches | Hardware Done — only this layer |

Fixture software-green is not strip lit. Sim software path only is not strip lit. Preview is not Apply. `13rac1/wled-sim` is not in this tree.
