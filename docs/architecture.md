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

Web talks to the API by rewrite: `/api/:path*` and `/health` → `NIGHTPLOT_API_URL` (default `http://127.0.0.1:43181`). Browser fetches use same-origin paths (`apps/web/src/lib/api.ts`). Add a Light (`/discover`) loads `GET /api/lights` and `GET /api/discover` independently: a Find miss keeps enrolled Lights and does not render ServerDown; a Lights miss still does. Inspect (`/lights/:id`) loads `GET /api/lights` and `GET /api/lights/:id` the same way: a detail miss keeps enrolled Lights; a Lights miss still uses ServerDown.

## Catalog seams

First members. Home directories are the registration point.

| Seam | First member | Home | Notes |
| --- | --- | --- | --- |
| Controller | WLED | `packages/shared/src/controller/` | `wledController` — `wired: true`, capabilities through provision |
| Strip / driver | WS281x, SK6812 RGBW | `packages/shared/src/strip/` | `ws281xStrip` + `sk6812RgbwStrip` — both `wired: false`. Pixels go through WLED, not a local driver |
| Discovery | mDNS / SSDP / address probe | `packages/shared/src/discovery/` | `implementation: "registered"`. Empty results are honest |

`GET /api/catalogs` returns `catalogSnapshot()` (`packages/shared/src/catalog.ts`). `CURRENT_SLICE` is `"R6"`. Named strip presets live in `packages/shared/src/strip/presets.ts` (`stripPresets` on that payload) and seed the LED product catalog. Operator LED products (`LedProduct`) live in `packages/shared/src/strip/products.ts` and on that payload as `ledProducts`. `PATCH /api/lights/:id/led-product` attaches one to a Light (`ledProductId`). That is Nightplot bookkeeping, not a WLED write.

`registered` means the slot exists. It is not proof hardware passed. `ControllerDescriptor.implementation` / `wired` / `capabilities` stay honest (`packages/shared/src/controller/types.ts`).

## Domain types

| Symbol | File | Meaning |
| --- | --- | --- |
| `Light` | `packages/shared/src/lights.ts` | One enrolled controller + one strip. `ledProductId` is a catalog attach (null = manual fields) |
| `Element` | same | Inclusive–exclusive range on that strip |
| `BeadColor` | `packages/shared/src/bead.ts` | Colour, `null` (off), or `"unknown"` (grey) |
| `stripHonestyForLight` | `packages/shared/src/strip/honesty.ts` | rgb / rgbw + chip caption from product, else `stripKind` |
| `WledSnapshot` | `packages/shared/src/wled/snapshot.ts` | Parsed `/json` (info + state) |
| `WledSafeSettings` | `packages/shared/src/safe.ts` | Small Safe set; fingerprint-gated |
| `WledStripProvision` | `packages/shared/src/provision.ts` | First-time bus: type / length / GPIO plus live `nativeOrder` / `colorOrder`. `buildProvisionWrite` authors `order: 0` (GRBW / `COL_ORDER_GRB` on RGBW) only on native type change; same-type length / GPIO clones the live `order` |
| `LedProduct` | `packages/shared/src/strip/products.ts` | Operator LED SKU. `formFactor` is metadata. `driverId` must be a registered strip driver |

Unreachable: `markUnreachable` in `apps/server/src/domain.ts` clears `on` / `brightness`. `beadFor` returns `"unknown"` — never a stored last colour. An info-only snapshot (skipped or hung `/json/state`) keeps `on: null` and `segments: null`. Power unknown is not off: Lights / Inspect say **Online · unknown**, and `beadForReportedOn` paints unknown-grey. Known `on: false` stays **Online · off**. Missing segments are not zero: `segmentCount` is null (**segments unknown**). A known empty `seg: []` stays **0 segments**. Drift compare skips when `segments` is `null` — it does not treat unknown as `[]`. Apply reread skips `applyOutcome` when `segments` is `null` (`applyUnknownSegments`) — unknown is not an empty match. A known empty list still compares as empty. Write-failed and reread-failed set `apply.read` to `null` (`applyUnreadFailed`) — they do not invent a known empty `[]`. `applyCaption` follows that read: unread / unknown-read does not say the controller reported ranges. A known reread still does. Apply leftover-segment clears use `snapshotSegmentCount` — unknown is not `0` and does not author `stop: 0` leftovers. Apply refuses that write until the count is known. Edit-ranges `ApplyFailed` shows `apply.message` (unknown-reread refuse ≠ didn’t-stick). Edit ranges rows use that same refuse (**no compare**) — they do not say matches until a report exists. The selected-Element kind chip uses it too — it does not say **seg** until a report exists. Invert and past strip use the same words as the list row — not generic overlap. Overlap and drift still win when those apply. Preview restore omits `seg` when `segments` is `null` — it does not invent a whole-strip write from colour. ApplyFailed **Use controller’s** adopts `apply.read` only when that list is known and non-empty (`adoptableControllerRanges`); unknown or empty disables the action and names why.

`Light.rgbw` is the last `/json/info` `leds.rgbw`. Inspect and Lights beads use `LightView.stripBead` / `stripChip` from `stripHonestyForLight` (attached `LedProduct`, else persisted `stripKind`). A successful Strip cfg read or Apply stores a known `ledType` on `stripKind`. A live Inspect GET may also read `/json/cfg` once when `stripKind` is still the default and `ledProductId` is null, then persist a known mapped `ledType`. The Lights list does not GET cfg. Snapshot rgbw is not a driver name.

Strip Apply (`buildProvisionWrite`) writes WLED `order: 0` (GRBW on SK6812 RGBW; `COL_ORDER_GRB`) only when the native bus type changes — convert, including unknown → mapped. A length or GPIO Apply that keeps the same type leaves the colour order already on the box. Strip names that live/preserved order after Apply (and on the cfg read). A non-GRBW SK6812 order is said out loud — not a blank. The Strip form does not pick colour order. Extra mapping rows are not registered. The Strip failure panel titles from `provisionWrite.message` (cfg mismatch / refuse ≠ didn’t-stick). A `buildProvisionWrite` refuse 422 includes `provisionWrite` — same as `provisionRefuseReason` — so that panel is shown, not a notice-only line. Fixture software-green is not Hardware Done. Preview is not Apply.

## Server

`createApp` in `apps/server/src/app.ts` is the rack. Boot: `apps/server/src/index.ts`.

| Piece | Symbol | File |
| --- | --- | --- |
| HTTP | `createApp` | `apps/server/src/app.ts` |
| Store | `FileLightsStore` | `apps/server/src/store/lights-store.ts` |
| LED products | `FileLedProductsStore` | `apps/server/src/store/led-products-store.ts` |
| Probe | `createWledProbe` | `apps/server/src/wled/client.ts` (`TIMEOUT_MS` 3000). All Off unknown-row copy is `allOffNoAnswerReason` — elapsed or generic refuse, not a claimed 3 s. Delete unknown-controller copy is `deleteUnknownControllerReason` — elapsed or generic refuse, not “in time” |
| Live write / `/json/live` | `createWledWriter`, `createWledLiveReader`, `restoreOnField`, `restoreBriField`, `restoreColField`, `restoreSegField`, `applyRangesWrite` | `apps/server/src/wled/live.ts`. Preview / Blink restore omits `on` / `bri` / `seg` / segment `col` when the snapshot did not know them — never `null → true`, `null → 128`, `null → #ffa000`, or `null →` a whole-strip segment from colour. Known empty `seg: []` restores as empty. Apply leftover-segment clears refuse when `snapshotSegmentCount` is unknown — never `null → 0`. Apply refuses unknown colour (`applyRefuseReason` / `knownApplyColor`) — never `null → #ffa000`. Preview is not Apply. |
| cfg | `createWledCfgReader`, `createWledCfgWriter` | `apps/server/src/wled/cfg.ts` |
| Live sessions | `createLiveEngine` | `apps/server/src/live/engine.ts` |
| Find collect | `createCollector` | `apps/server/src/discovery/collect.ts` |
| Find probe bound | `FIND_PROBE_CONCURRENCY` (4) | `apps/server/src/discovery/map-limit.ts` |
| All Off Light bound | `ALL_OFF_PROBE_CONCURRENCY` (4), `mapLimitSettled` | `apps/server/src/discovery/map-limit.ts` |
| Fixture | `createFixtureBox` | `apps/server/src/wled-fixture-box.ts` |

`GET /health` returns `{ ok, service: "nightplot-configure", slice: CURRENT_SLICE }`.

`GET /api/lights` still calls `refreshOne` (a probe) for every enrolled Light, then `lightDetail`. The Lights **list component** does not start its own probes; Inspect Refresh is the one-Light UI probe. The server list path is a known gap — leave it unless that gap is the slice you are on.

## LAN guard

`decideProbeAddress` / `isLanAllowed` / `displayHost` / `parseHostPort` live in `packages/shared/src/net/address.ts`. Public addresses are `disallowed-address` before HTTP. See [SECURITY.md](../SECURITY.md).

Find must use an advertised port (SSDP `LOCATION` in `apps/server/src/discovery/parse.ts`, mDNS SRV) or list the row as needs host:port. Typed host with no port still means `:80`.

## Persistence

`FileLightsStore` writes `{ version: 1, lights, elements }` to `data/lights.json` (or `NIGHTPLOT_STORE_PATH`). A Light may carry `ledProductId` (null if the operator keeps manual Strip fields). `FileLedProductsStore` writes `{ version: 1, products }` to `data/led-products.json` (or `NIGHTPLOT_LED_PRODUCTS_PATH`). First boot seeds from `STRIP_PRESETS`. Neither file is a WLED write.

## Stubs / NYI (honest)

| Thing | Status |
| --- | --- |
| Docker / compose / GHCR | Image + compose for local/LAN run. See [deploy.md](deploy.md). No auth or TLS |
| Local strip driver | Catalog members registered (WS281x, SK6812 RGBW); `wired: false` |
| Auth / public bind | Not present. Defaults loopback. Containers bind `0.0.0.0` for published ports — LAN publish, not a public-internet deploy |
| Hardware Done | Not claimed. The fixture is a software stub for development |

API routes: [README.md](../README.md#api). UI routes: [README.md](../README.md#ui).
