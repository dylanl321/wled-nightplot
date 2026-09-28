# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Slice lines (`0.7.x`) are not SemVer marketing numbers.

## Unreleased

- Preview locate now sends immediately and follows continuous movement at up to 20 requests per second, with one request in flight and only the latest pending position. Moving no longer restarts a 220 ms settle timer. Failed, timed-out, or incomplete responses pause Preview and show **Retry Preview**; uncertain writes are not replayed automatically. Within one editor, toggle-off/unmount waits for the in-flight request before End Preview, and a rapid restart waits for that end to finish. Apply remains disabled during cleanup. This is a client-side repair; hardware timing, transport changes, and cross-tab/server cancellation remain separate work.

### Added

- Find starts while Nightplot is open. The shell posts `POST /api/discover` on load and about once a minute while the tab is visible, and pauses while the tab is hidden. Lights and Add a Light show the new rows. **Find Lights** runs that scan again. A scan still refuses public addresses and still will not invent a port.
- LED product geometry: optional `pitchMm` (discrete and diffused, centre-to-centre) or `sectionLengthMm` (COB, one addressable section). Lights, the Light page, each Element, and Strip show node count times that spacing. The figure is calculated from the recipe and the node count — not a tape measurement, and not written to WLED. Missing spacing leaves the node count alone. Voltage, watts per metre, IP rating, strip width, cut length, and density notes stay under Advanced on the recipe. Advanced facts do not change the length.
- Catalog delete (CONFIG-118): `DELETE /api/led-products/:id` removes a shared LED recipe only when no Light still attaches that `ledProductId`. Unknown or partial attach counts refuse (422) — they are not treated as zero. A known attach refuses (409). There is no “I understand” override. Manage UI on `/led-products` runs the Lights-attach check and keeps refuse chrome (`Remove · 0 of 1 checks`) — it does not look Done on refuse. Clear only when the count is known zero. Catalog delete is bookkeeping — not Apply, not a WLED write, not Hardware Done.
- Headless WLED sim e2e lane (CONFIG-91): CI and `pnpm test` spawn a WLED-compatible HTTP+/DDP endpoint as an **external process** (`pnpm sim`, default `127.0.0.1:48211`, DDP UDP `4048`). Integration covers enroll → provision → Apply → live/DDP, plus Apply mismatch / unknown reread, All Off partial_failure, and incomplete delete. Sim enrolls use the Quiet caption **software path only**. This is not Hardware Done. Three Done layers stay distinct: in-process fixture → sim/e2e → metal (human benches). `13rac1/wled-sim` is not vendored (AGPL; its JSON surface has no `/json/cfg` or `/json/live`).
- LED product catalog manage UI (CONFIG-113): `/led-products` lists, creates, and edits shared LED type / IC recipes. `PATCH /api/led-products/:id` mutates the catalog recipe only (SKU / driver / defaults; id stays). It does not write WLED and does not invent this Light’s length, GPIO, or ranges. Strip attach still fills this Light’s fields and stays Nightplot bookkeeping — not Apply, not a WLED write, not Hardware Done. Copy names shared catalog vs this Light. Apply still writes only that Light’s bus. Preview is not Apply.
- Strip shows the live bus colour order after a same-type Apply (CONFIG-64). An SK6812 bus that is not GRBW is named (RGBW, RBGW, or `WLED order N`) — no silent blank. Convert still authors GRBW (`order` 0). There is no colour-order picker. The fixture accepts `NIGHTPLOT_FIXTURE_NATIVE_ORDER` (default 0). Fixture software-green is not Hardware Done. Preview is not Apply.
- Inspect seeds `stripKind` from a live `/json/cfg` GET when the Light still has the default driver and no LED product (CONFIG-60). A known mapped `ledType` (same mapping as Strip) is persisted. Snapshot `leds.rgbw` is not a chip. The Lights list stays cfg-free. Unreachable stays grey with last-seen. Fixture type 30 is software-green, not Hardware Done. Preview is not Apply.
- Bead / Inspect honesty for RGBW (CONFIG-55): Inspect chips and strip beads follow the attached LED product, then the persisted strip driver. SK6812 RGBW grows a second die and is captioned RGBW; WS281x stays a single RGB die. Snapshot `leds.rgbw` is not labeled "WS281x RGBW". Unreachable beads stay grey with last-seen — never the last colour. Elements / ranges are unchanged. A registered driver is not Hardware Done. Preview is not Apply. Full RGBWW UI is out of scope.
- SK6812 RGBW strip driver (CONFIG-54): second catalog member (`sk6812-rgbw`) with four channels, GRBW, and an RGBW bead. Provision read/write maps WLED `TYPE_SK6812_RGBW` (30) and order 0 (`COL_ORDER_GRB` / GRBW) on the same supported firmware set as WS281x. Products may name the new `driverId`. Unknown types and unsupported firmware still refuse — nothing is written. The fixture can start as or accept type 30 (`nativeType`, `NIGHTPLOT_FIXTURE_NATIVE_TYPE`). RGBWW stays unmapped. COB stays metadata. Fixture software-green is not Hardware Done. Preview is not Apply.
- Strip attach for LED products (CONFIG-53): an enrolled Light stores `ledProductId` (null = manual fields). Strip lists the catalog; picking a product fills type / length / GPIO from that SKU and its driver. Fields still override. Attach is Nightplot bookkeeping — not Apply, not a WLED write, not Hardware Done. Apply stays fail-closed on existing WS281x provision. Presets remain as catalog seeds.
- Operator LED product catalog (CONFIG-52): Nightplot-owned SKUs (`id`, `label`, `notes`, `formFactor` discrete / cob / diffused, `driverId` against the strip driver catalog, optional channel / color-order / bead overrides or inherit from the driver, optional `defaultLength` / `defaultGpio` / `densityNotes`). JSON store `data/led-products.json` (`NIGHTPLOT_LED_PRODUCTS_PATH`). First boot seeds three WS281x rows from `STRIP_PRESETS`. `GET`/`POST /api/led-products` and `GET /api/led-products/:id`; `GET /api/catalogs` includes `ledProducts`. Fail closed on unknown `driverId`, bad `formFactor`, or bad defaults. Form factor is metadata — not written to WLED. A catalog row is not Hardware Done. Strip UI attach is CONFIG-53.
- Docker image, compose, and GHCR workflow (CONFIG-45). One image (`api` / `web` / `all`); `docker-compose.yml` runs web + api in a shared network namespace with a lights-store volume. Bind `0.0.0.0` and optional `NIGHTPLOT_CORS_ORIGINS` are env-gated for containers — `pnpm dev` stays loopback. Find multicast from a container often fails; `docker-compose.host.yml` is the Linux host-network path. Typed address still works. The image packages local/LAN run; there is no auth or TLS.
- Repo documentation and governance files (CONFIG-44): README hub, CONTRIBUTING, CONSTITUTION, SECURITY, MIT LICENSE, `docs/overview.md` / `install.md` / `deploy.md` / `architecture.md`, GitHub issue and PR templates. Docker / compose / GHCR landed in CONFIG-45.

### Changed

- **Elements stay lit** (Hold locate) keeps each Element as a whole colour. The hover LED is marked only when it sits in a gap — it does not punch a split into the Element on every mousemove. **Cursor only** stays one target. Beads match that picture. Preview is not Apply. tip/sim/e2e is not Hardware Done (CONFIG-127).
- **Show on the real strip** locate writes no longer rebuild a full-strip black|lit|black `seg[]` on every hop. The HTTP picture is one whole-strip black underlay plus merged lit pieces (`tt: 0` so WLED does not fade-crawl). When only the cursor LED moved, the POST names that one segment — the underlay is left unmentioned. Adjacent same-colour merge stays. This is still Preview, not Apply, and still HTTP — not UDP or websocket. tip/sim/e2e is not Hardware Done (CONFIG-126).
- Preview locate hops update an open session without a new snapshot. A hop that matches the last write does not POST. Locate hops skip `/json/live` unless `{ reread: true }` — they do not invent a report or call that Apply. End Preview still restores only known fields from the first snapshot. **Show on the real strip** refuses Apply immediately — it does not wait for the first hop to write `session.kind`. Preview is not Apply. tip/sim/e2e is not Hardware Done (CONFIG-125).
- **Show on the real strip** (Preview locate) sends the latest hop, not every hover or drag frame. Superseded frames drop while a hop is in flight. A POST that would repeat the last start/stop/color or spans is skipped. Hover and drag settle longer than an intentional hold, so a parked LED still lights promptly. Locate hops do not refresh the Light page / bead strip every time — the caption on the strip can still update. Preview is not Apply. tip/sim/e2e is not Hardware Done (CONFIG-124).
- `docs/PLANE.md` series and issue-id tables refreshed from live Plane: 131 filed CONFIG issues (sequence 1–133). Live-locate family CONFIG-124–128 is listed. CONFIG-129 and CONFIG-130 are not filed. Do not invent unfiled numbers (CONFIG-133).
- The Elements drift banner names each difference once: the range on this page, and the ranges the controller still has. **Show on the real strip** has **Cursor only** (one target, rest unlit) and **Elements stay lit** (every Element keeps its colour; a gap LED under the cursor can be the bright one). Preview is not Apply.
- Elements is a strip editor: drag, resize, cut, and combine ranges on the Light. Free runs and a LED selection create Elements. Colour on the strip is display-only and is not saved. **Show on the real strip** is Preview — the hovered LED, the LED selection, or the one selected Element, with the rest of the strip unlit. `POST /api/lights/:id/preview` accepts `{ start, stop, color }` for that locate and blacks every other LED; naming an Element still paints one segment, and Blink keeps that path. Save and Save & Apply stay refused while a range is inverted, overlapping, or past the strip. Unreachable beads stay grey. Preview is not Apply.
- The Configure shell is a 56px top bar (Lights, LED products, All Off). A Light has Elements and Settings. Lights are cards with a found banner. `GET /api/lights` includes each Light’s declared ranges from the list’s existing range display. Preview is not Apply.
- Public docs state enroll-then-assign: the LED product catalog is the shared type / IC recipe (managed on `/led-products`); length, GPIO, ranges, and overrides live on the Light; Strip-assist plugins (length helper first; segment helper later) are modular help and do not replace catalog attach. Attach is not Apply. A length helper is not on Strip today. Preview is not Apply. A catalog row is not Hardware Done (CONFIG-115).
- Strip Apply authors GRBW (`order: 0` / `COL_ORDER_GRB`) only when the native bus type changes to a mapped type, including convert to SK6812 RGBW. Same-type length or GPIO writes keep the colour order already on the box. There is no order picker. Fixture software-green is not Hardware Done. Preview is not Apply (CONFIG-59).
- `docs/PLANE.md` lists filed CONFIG tickets through CONFIG-50 and records the live GitHub home `dylanl321/wled-nightplot` with package name `nightplot-configure` (CONFIG-34).
- Public docs describe Nightplot Configure as a standalone LAN utility (CONFIG-50). README and overview open with what the product is, who it is for, and how to run it. Lights, Elements, Preview, Apply, Blink, and All Off are defined in positive vocabulary. Early-software facts (LAN, no auth, no TLS, fixture is a development stub) replace documentation-about-documentation meta.

### Fixed

- App-test `memoryBox` now applies unnamed + leftover `stop: 0` in array order (`id | it`), matching the fixture after CONFIG-143. Leftover pre-pass before unnamed apply was the test-double gap — a later leftover `id: 1` can drop a just-inferred second range, so End Preview multi-range + leftover regression is visible in app tests. Does not invent leftover counts. Production End Preview still names restore ids leftover-first (CONFIG-146). Preview is not Apply. tip/sim/e2e is not Hardware Done (CONFIG-148).
- End Preview restore after a locate overlay now names restore range ids and posts leftover overlay `stop: 0` first. Leftover `id: 1` no longer drops a second restore range under WLED `id | it`. Does not invent leftover counts. The fixture still applies an unnamed leftover-last write the way WLED would. Preview is not Apply. tip/sim/e2e is not Hardware Done (CONFIG-146).
- Inspect / Light refresh no longer replaces a first-locate unknown leftover `liveCaption` with a live-read / fixture line. While that Preview session is open, leftover lights stay captioned as not this locate and not Applied. Refresh does not invent leftover counts. Named-Element leftover-count caption is unchanged. Preview is not Apply. tip/sim/e2e is not Hardware Done (CONFIG-145).
- Fixture unnamed + leftover `stop: 0` now apply in array order (`id | it`), matching WLED. A later leftover `id: 1` `stop: 0` can drop a just-inferred second unnamed range. Leftover pre-pass before inferred apply was the fixture gap. Unmentioned leftover overlay ids still stay. Production leftover `stop: 0` is still the stand-in that clears leftover pixels. Preview is not Apply. tip/sim/e2e is not Hardware Done (CONFIG-143).
- First locate Preview no longer treats an unknown restore segment count as a silent leftover-clear. Soft `firstLocateWrite(null)` still posts the overlay picture without inventing leftover ids. The caption says segments are unknown and leftovers were not cleared — not this locate, not Applied. Apply still refuses leftover clears without a count. Preview is not Apply. tip/sim/e2e is not Hardware Done (CONFIG-142).
- Fixture unnamed Preview write now retains leftover overlay ids the way WLED does (omitted `id` is inferred from array order; leftover overlay ids that were not mentioned stay). Leftover pixels stay until an explicit leftover `stop: 0`. Replacing `state.seg` was the fixture gap — leftover pixels + leftover `stop: 0` remain the production stand-in, not metal. Preview is not Apply. tip/sim/e2e is not Hardware Done (CONFIG-141).
- End Preview restore after a locate overlay now `stop: 0`s leftover overlay ids we authored. Restore still writes known fields only — it does not invent a leftover count or restore ranges. Named-Element / Blink switch leftover clears stay CONFIG-136. Preview is not Apply. tip/sim/e2e is not Hardware Done (CONFIG-140).
- Locate overlay hops reuse previous overlay ids when start/stop/col match, so a gap cursor between Elements does not remap later lit ids (Door 10–14 stays id 2, not 3). Hop packing posts only the cursor — it does not rewrite an unchanged Element. This is hop packing, not a stored Element→seg identity. First pictures stay 0…n. Preview is not Apply. tip/sim/e2e is not Hardware Done (CONFIG-138).
- First locate Preview write now `stop: 0`s leftover controller segments above overlay ids when the snapshot count is known and higher (same leftover-id class as Apply’s known-count clears). `overlayLocatePicture` still builds 0…n; later hops still only clear leftovers vs the prior locate picture. Unknown segment count does not invent leftover ids. Preview is not Apply. tip/sim/e2e is not Hardware Done (CONFIG-137).
- Leaving locate overlay for a named-Element or Blink Preview now clears leftover overlay ids we authored (`stop: 0`). `previewWrite` without `ledCount` still posts one un-id’d segment. It does not invent a first-locate leftover count. Preview is not Apply. tip/sim/e2e is not Hardware Done (CONFIG-136).
- v2 Edit-ranges canvas (#2d) bead legend no longer always paints dashed **drift** and solid **overlap**. Keys follow the framed scene the same way the running app does after CONFIG-103 / CONFIG-92: drift only when compare shows drift; the red key only when invert, past strip, or overlap is present. This scene has both, so both keys still show — they are not a permanent always-on demo set. Preview is not Apply. Fixture software-green is not Hardware Done (CONFIG-116).
- Strip GET/load refuse shows once on the form banner. Notice is not set from `provision.refuse`, and `read.caption` is not repeated under the form. CONFIG-105-class write-path Sent / Read (`provisionWrite`) is unchanged. Preview is not Apply. Fixture software-green is not Hardware Done (CONFIG-119).
- Safe settings GET/load refuse shows once on the form banner. Notice is not set from `safe.refuse`, and `read.caption` is not repeated under the form. CONFIG-105 write-path Sent / Read back panel is unchanged. Preview is not Apply. Fixture software-green is not Hardware Done (CONFIG-117).
- Known empty Apply reread caption no longer ends **until you see them on the strip**. There are no ranges to see. The suffix is **until you look at the strip**. Unread (`null`) keeps the CONFIG-90 suffix. Preview is not Apply. Fixture software-green is not Hardware Done (CONFIG-108).
- Safe settings refuse and write failure now use a `safeWrite` Sent / Read back panel, same as Strip `provisionWrite`. The write message is the panel title once — notice is hidden while that panel is up, so a refuse does not print two identical destructive lines. Preview is not Apply. Fixture software-green is not Hardware Done (CONFIG-105).
- Edit ranges bead legend dashed key no longer always shows **drift**. The key only appears when drift is present and compare is meaningful. A match or refused compare hides it. Preview is not Apply. Fixture software-green is not Hardware Done (CONFIG-103).
- `validateDeclaredRanges` names past strip (`over-ledCount`) when an inverted range’s start is already past the strip (80–40 on 60 LEDs). Invert-only in-strip ranges stay invert. Combined invert copy names past strip when both apply so Edit-ranges footer / Apply refuse are not invert-only. Preview is not Apply. Fixture software-green is not Hardware Done (CONFIG-104).
- Find sends mDNS and SSDP on each non-loopback IPv4 except `169.254.0.0/16`, so a controller on Wi-Fi answers when another adapter wins the multicast route. mDNS rows are only `_wled._tcp` SRV records. Other services heard on the link are not probed.
- Known empty Apply reread (`apply.read` `[]`) caption no longer says **The controller reported these ranges**. It says **reported no ranges**, same honesty as adopt-empty. Unread (`null`) stays CONFIG-90 unread caption. A known non-empty reread still says these ranges. Preview is not Apply. Fixture software-green is not Hardware Done (CONFIG-98).
- Safe settings `buildSafeWrite` refuse 422 now includes `safeWrite`, same as `safeRefuseReason`. The refuse body can drive the write-failure UI — not a notice-only line that can be mistaken for a lesser miss. Preview is not Apply. Fixture software-green is not Hardware Done (CONFIG-93).
- Edit ranges bead legend red key no longer hardcodes **overlap**. Invert and past strip use the same words as the selected kind chip and list row. The key only appears when invert, past strip, or overlap is present. True overlap still says overlap. Preview is not Apply. Fixture software-green is not Hardware Done (CONFIG-92).
- ApplyFailed caption no longer says **The controller reported these ranges** when nothing was read. Write-failed, reread-failed, and unknown-reread (`apply.read` null) use unread caption. A known reread keeps the reported-ranges wording. Caption follows the read, not the source. Preview is not Apply. Fixture software-green is not Hardware Done (CONFIG-90).
- Strip Apply `buildProvisionWrite` refuse 422 now includes `provisionWrite`, same as `provisionRefuseReason`. Strip shows the failure panel — not a notice-only line that can be mistaken for a lesser miss. Preview is not Apply. Fixture software-green is not Hardware Done (CONFIG-89).
- Edit ranges selected-Element kind chip no longer says **overlap** when the rail error is invert or past-strip (`over-ledCount`). The chip uses the same words as the list row. True overlap still says overlap. Preview is not Apply. Fixture software-green is not Hardware Done (CONFIG-87).
- Apply write-failed and reread-failed no longer invent `apply.read` as a known empty list. When no segment list was read, `read` is `null` — not `[]`. A known empty reread `seg: []` still reports `[]`. Same honesty class as CONFIG-78 unknown-reread. Preview is not Apply. Fixture software-green is not Hardware Done (CONFIG-86).
- Strip Apply failure no longer titles a cfg mismatch or refuse as **Apply didn’t stick**. The panel uses the provision result message: **Wrote, but /json/cfg did not match. Not treating as success.** A cfg-refuse stays that refuse copy. Preview is not Apply. Fixture software-green is not Hardware Done (CONFIG-84).
- Apply leftover-segment clears no longer invent previous count 0 from a missing `state.seg`. Unknown (`null` after info-only / skipped `/json/state`) refuses leftover `stop: 0` clears and the Apply write. A known empty `seg: []` still applies with no leftover clears. Same honesty class as **segments unknown** ≠ 0 and unknown reread. Preview is not Apply. Fixture software-green is not Hardware Done (CONFIG-83).
- Edit-ranges Apply failure no longer titles an unknown-reread refuse as **Apply didn’t stick**. The panel uses the Apply result message: **Wrote, but segments are unknown. Not treating as success.** A known mismatch still says didn’t stick. Same honesty class as unknown segments ≠ empty. Preview is not Apply. Fixture software-green is not Hardware Done (CONFIG-81).
- Edit-ranges Apply failure no longer offers **Use controller’s** as a silent no-op when the reread did not name ranges. Unknown (`apply.read` null) and a known empty report disable the action and say why. A known mismatch still adopts those ranges. Preview is not Apply. Fixture software-green is not Hardware Done (CONFIG-85).
- Preview restore no longer invents a whole-strip segment from an info-only snapshot. When `/json/info` answered but `/json/state` was skipped or hung (`segments: null`), end-Preview / Blink restore and Find Blink restore omit `seg` instead of coalescing unknown to `[]` and writing `{ start: 0, stop: ledCount }` from colour. Known empty `seg: []` restores as empty. Known ranges stay. Same honesty class as omitted `on` / `bri` / `col`. Preview is not Apply. Fixture software-green is not Hardware Done (CONFIG-82).
- Edit ranges selected-Element kind chip no longer says **seg** when compare is refused (unknown `state.seg` or unreachable). The chip uses the same refuse class as the footer (**no compare**). Overlap and drift still win when those apply. A known empty `seg: []` still compares. Preview is not Apply. Fixture software-green is not Hardware Done (CONFIG-80).
- Apply no longer invents `#ffa000` when the snapshot did not name a colour. Info-only or missing `segmentColor` refuses Apply (422) and writes nothing — same honesty class as CONFIG-72/73 restore omit. Known colours still Apply. Preview is not Apply. Fixture software-green is not Hardware Done (CONFIG-76).
- Edit ranges row status no longer says **matches** when segments are unknown or compare is refused. The row uses the same refuse class as the footer (**no compare**). A known empty `seg: []` still compares and can show drift or matches. Preview is not Apply. Fixture software-green is not Hardware Done (CONFIG-79).
- Apply reread no longer coalesces unknown segments (`null` after info-only / skipped `/json/state`) to `[]` before `applyOutcome`. Unknown skips the match compare and stays failed — not a false empty match. A known empty `seg: []` still compares as empty. Same honesty class as CONFIG-75 drift skip and CONFIG-71 **segments unknown** ≠ 0. Preview is not Apply. Fixture software-green is not Hardware Done (CONFIG-78).
- Unknown segments (`null` after info-only / skipped `/json/state`) no longer feed empty rails into drift compare. Inspect, Lights, and Edit ranges skip declared-vs-report until `state.seg` is known. A known empty `seg: []` still compares as empty. Same honesty class as **segments unknown** ≠ 0. Preview is not Apply. Fixture software-green is not Hardware Done (CONFIG-75).
- Inspect loads enrolled Lights and one-Light detail separately. A detail-only miss keeps the enrolled rail and says this Light did not load (or is not on Lights) — it does not claim the configure server or the list is down. Lights-only outage still uses ServerDown. Unreachable beads stay grey with last-seen (CONFIG-16).
- Info-only live (skipped or hung `/json/state`) no longer reports `segmentCount: 0` for a missing `seg`. Lights and Inspect say **segments unknown**. A known empty `seg: []` stays **0 segments**. Same honesty class as missing `on`. Preview is not Apply. Fixture software-green is not Hardware Done (CONFIG-71).
- Preview restore no longer invents brightness or colour from an info-only snapshot. When `/json/info` answered but `/json/state` was skipped or hung (`brightness: null`, `segmentColor: null`), end-Preview / Blink restore and Find Blink restore omit `bri` and segment `col` instead of writing brightness `128` or `#ffa000`. Known values stay. Same honesty class as omitted `on`. Preview is not Apply. Fixture software-green is not Hardware Done (CONFIG-73).
- Preview restore no longer invents power from an info-only snapshot. When `/json/info` answered but `/json/state` was skipped or hung (`on: null`), end-Preview / Blink restore and Find Blink restore omit `on` instead of writing `on: true`. Known off stays off. Preview is not Apply. Fixture software-green is not Hardware Done (CONFIG-72).
- Info-only snapshots (`on: null` after skipped or hung `/json/state`) no longer read as **Online · off**. Lights and Inspect say **Online · unknown**; beads use unknown-grey — the same honesty class as last-seen, distinct from known off. A leftover colour is not shown. Known `on: false` stays Online · off (CONFIG-37).
- All Off probes enrolled Lights concurrently with a bound of **four** (`ALL_OFF_PROBE_CONCURRENCY`). It no longer waits for one dead Light before starting the next. Each Light settles fail-closed: unknown / failed stay unknown / failed — no invented success across the rack. Unknown copy stays CONFIG-36 (`allOffNoAnswerReason`): instant, unmeasured, or under ~0.5 s is generic **no answer from {host}.** A measured wait of at least ~0.5 s may name the elapsed seconds — not a claimed 3 s. `FileLightsStore.replace` stays a sync read-modify-write so overlapping Light jobs do not drop a sibling. Fixture software-green is not Hardware Done (CONFIG-68).
- Delete unknown controller copy no longer invents “in time”. Instant refuse or an unmeasured wait is generic **Couldn’t read it, so we can’t say what it’ll be left doing.** A measured wait of at least ~0.5 s names the actual elapsed seconds — same honesty class as CONFIG-28 / CONFIG-36. v2 Delete canvas uses the generic string (CONFIG-67).
- All Off unknown rows no longer hardcode “in 3 s”. Instant refuse is generic **no answer from {host}.** A wait of at least ~0.5 s names the actual elapsed seconds — same honesty class as CONFIG-28, All Off product string. v2 All Off canvas Garage example uses the generic string (CONFIG-36).
- Discover loads enrolled Lights and Find separately. A Find-only miss keeps the enrolled list and says Find did not load, with Find Lights as retry — it does not claim the configure server or the list is down. Lights-only outage still uses ServerDown (CONFIG-49).
- ServerDown recovery copy names both the local `pnpm dev` path and Docker compose / `docker run` restart (`docs/deploy.md`). It no longer tells a compose operator to run host `pnpm dev` (CONFIG-46).

## 0.7.11 — Elements after strip length change (CONFIG-43)

- After a successful length-changing Strip Apply, declared Elements are reconciled against the new `ledCount`. Ranges that run past the new strip are clipped; ranges that start past it are dropped. Grow does not invent Elements — leftover coverage is flagged.
- The Apply result names what changed. Inspect / Edit ranges / the Lights row use the re-read drift story and do not claim Elements still match the new strip.
- Mismatch / GPIO-only Apply does not rewrite ranges. Fixture software-green is not Hardware Done.

## 0.7.10 — Named strip presets (CONFIG-41)

- The strip catalog ships at least three built-in presets: WS281x with documented length / GPIO defaults (60 · GPIO 16, 150 · GPIO 16, 300 · GPIO 2). Labels name the fields they fill. These are not a confirmed install pinout.
- Selecting a preset fills the CONFIG-40 Strip form. Fields still override. Apply is the same write → cfg reread → snapshot check. Preview is not Apply.
- Presets live in `packages/shared` and appear on `GET /api/catalogs` (`stripPresets`). The form is not a one-off hardcoded blob.
- Fixture software-green is not Hardware Done.

## 0.7.9 — First-time WLED strip provision (CONFIG-40)

- An enrolled Light can set LED type (WS281x first), length (node count), and GPIO/pin on **Strip**.
- Apply writes reviewed `/json/cfg` bus fields (`hw.led.ins[]` pin / len / type) from the Nightplot compatibility mappings, then re-reads cfg **and** the snapshot. Mismatch stays on the failure UI — no silent success.
- Fail closed: no `ins` list, empty or multi-bus, analog/network/HUB75 types, more than one pin, or firmware outside the WS281x table. Unknown types are not written; unsupported firmware is not silently written.
- Existing unknown bus fields are cloned, not replaced. Fixture software-green is not Hardware Done. Preview is not Apply.

## 0.7.8 — Preview keeps reported range rails (CONFIG-30)

- POST `/api/lights/:id/preview` and `/blink` no longer overwrite Inspect `reported` (range rails) with live match counts `{ matched, total }`.
- Match counts live on `liveMatch`. LightDetail maps `reported` as rails; a non-array payload is treated as no rails — no `.map` crash, and no ServerDown “list is not loaded” story for that contract throw.
- Proof ladder prefers `liveMatch`, then `/json/live` beads. Preview is still not Apply. Fixture readback is not Hardware Done.

## 0.7.7 — Bound hanging /json/state after /json/info (CONFIG-29)

- After `/json/info` proves liveness, `/json/state` is optional enrichment. A hang uses a short dedicated timeout (and never more than the remaining CONFIG-15 ~3 s budget). It does not add another full abort wait.
- If state is slow or missing, Find / Inspect still enroll from info: identity and `ledCount` stay; `on` / reported segments stay unknown — not a last colour. Unreachable stays grey with last-seen.
- Combined `/json` is unchanged. CONFIG-28 elapsed / generic `probe-failed` copy is unchanged. Fixture / stub answers are still not Hardware Done.

## 0.7.6 — Probe-failed copy uses elapsed or generic (CONFIG-28)

- `probe-failed` no longer always says “in 3 s”. Instant refuse (connection refused, fast HTTP miss) is generic **probe failed.** A wait of at least ~0.5 s names the actual elapsed seconds.
- Discover still shows the CONFIG-15 abort bound (“a dead probe stops in 3 s”). That is the budget, not a claim that this probe waited 3 s.
- v2 Discover typed-address “Nothing added” example uses the generic string. All Off “no answer … in 3 s” is unchanged (adjacent).
- Fixture / stub answers are still not Hardware Done. Unreachable stays grey with last-seen.

## 0.7.5 — Find probes collected hosts in parallel (CONFIG-27)

- `POST /api/discover` probes collected hosts with a bound of **four** at a time (`FIND_PROBE_CONCURRENCY`). It no longer waits for one dead box before starting the next.
- Each probe still uses the CONFIG-15 ~3 s abort. `probe-failed` / `not-wled` / missing-port / already-added / disallowed-address stay per-host. Result order follows collect order.
- Lights list re-probe policy is unchanged: list does not re-probe; Inspect Refresh is the one-Light live probe.
- Fixture / stub answers are still not Hardware Done. Unreachable stays grey with last-seen.

## 0.7.4 — Discover / Lights component tests (CONFIG-23)

- `apps/web` has a Vitest + Testing Library harness (`pnpm --filter @nightplot/web test`, included in `pnpm test`).
- Discover and the unenrolled tray render Espalexa `portWarning` and offer Type host:port. Listed host stays `displayHost` (hide default `:80`) while the warning may still talk about `:80`.
- Lights list paints cached last-seen / unknown grey beads and does not probe. Inspect Refresh is the one-Light live probe.

## 0.7.3 — Discover canvas default-port host matches displayHost (CONFIG-32)

- v2 Discover not-WLED reject row shows `192.168.1.80`, not `192.168.1.80:80`. Same as live `displayHost` (hide default `:80`). Desktop 2b and the phone frame.
- Discover honesty note: listed hosts follow `displayHost` — omit `:80` unless the port is not 80.

## 0.7.2 — Safe settings rename uses the cfg name (CONFIG-11)

- After a successful display-name write, the enrolled Light title (rack, rail, Inspect) uses the name from `/json/cfg` immediately.
- Real WLED may keep the old `/json/info` name until reboot. Nightplot does not wait, and does not silently keep the stale title. If info still lags, the write result and Inspect say so.
- A later probe that sees info catch up (or move to a different name) follows `/json/info` again.
- Fixture: `NIGHTPLOT_FIXTURE_INFO_NAME_LAG=1` or `POST /nightplot/info-name-lag` `{ "on": true }` keeps `/json/info` stale after a cfg rename. Turning lag off copies cfg → info (reboot-shaped).

## 0.7.1 — Discovery uses advertised ports (CONFIG-9)

- SSDP candidates take host and port from LOCATION. No LOCATION → listed as needs host:port, not a fake :80 Add.
- mDNS uses the SRV service port (including 80 when the service advertised it). `data.port || 80` is gone. An A/AAAA without a service port is needs host:port.
- An http LOCATION without an explicit port is :80 (URL default), documented here and on Discover. Typed host still means :80.
- Typed address remains the escape hatch. The local fixture is `127.0.0.1:48210` — Find will not invent that port.

## 0.7.0 — R6 Safe settings (CONFIG-7)

- Safe settings live on an enrolled Light (Inspect → Safe settings): display name, turn-on-at-boot, boot brightness, boot preset, default transition, global current limit.
- Read and write go through `/json/cfg`. The fingerprint is the set of those fields this firmware actually exposed. Unsupported firmware is refused closed — nothing is written.
- A field this parser does not understand is not on the writable form and is not sent. Fixture `/json/cfg` is software-green, not Hardware Done.

## 0.6.0 — R5 Manage a few + All Off (CONFIG-6)

- Lights remains the manage surface: name, address, online, on, ledCount, and live segment count (unknown when the Light is not answering).
- All Off lives on the rail (desktop) and thumb bar (phone), including empty and error screens. One press runs it when nothing is live.
- If Preview or Blink is live, confirm expands in place. Confirming cancels without restoring, then powers off each reachable enrolled Light.
- The result lists each Light by what it reported. Retry targets only the failed ids. Fixture readback is captioned — not Hardware Done.
- Delete Light is a check that runs (Elements, live sessions, controller state). The button fills n of m and stays locked until every check is complete. Unknown or partial impact is not safe; there is no “I understand” override.
- Safe settings stay parked for CONFIG-7 / R6.

## 0.5.0 — R4 Apply ranges + re-address (CONFIG-5)

- Edit ranges Apply writes declared Element ranges to the controller, then re-reads the snapshot. Success only when reported ranges match what was sent.
- A mismatch or failed reread stays on the failure UI (sent vs read back, Use controller’s / Apply again). No success toast.
- Preview stays temporary and distinct. Test live “Apply to {Element}” is still not a saved look.
- Re-address probes the new host first. Same-MAC continuity keeps the Light id; identity (name / MAC / ledCount / segments) comes from the fresh snapshot. The old address stays until that proves out.
- Successful Apply and re-address persist the enrolled address and last-good snapshot. Fixture software-green is not Hardware Done.
- All Off stays R5.

## 0.4.0 — R3 Test live (CONFIG-4)

- Test live sits on the same Light strip as Inspect / Edit ranges. Pick one Element, or the whole strip.
- Preview writes a temporary solid colour and brightness, then the beads follow `/json/live` readback. Ending restores the previous look. Preview is not Apply.
- Preview disabled shows a one-line reason (offline, no target, Blink already running).
- Blink Identify pulses, then restores on completion or error. Discover can Blink a candidate the same way.
- Proof ladder: Sent → Controller reports → a person confirms. The ladder names the live target, not a different selected chip. Fixture readback is captioned software-green — not Hardware Done.
- A second Preview on the same Light keeps the original restore snapshot.
- Apply stays R4 (501 / disabled). All Off stays R5; the UI states that a live Preview would end without restoring.

## 0.3.0 — R2 Snapshot + Elements (CONFIG-3)

- Light Inspect shows identity and a linear `StripBeads` rail of `ledCount` (glowing beads from the v2 template).
- Elements are contiguous ranges: label, start inclusive, stop exclusive, length derived. Inspect / Edit ranges are modes on one strip.
- Declared brackets sit above the beads; reported WLED segments sit below. Coverage drift is labeled on the dual rails.
- Overlap, invert, and over-ledCount are editor errors: they paint red on the beads and block save of an invalid draft with a reason.
- Unreachable Lights stay grey with last-seen. No last colour and no last reported range are invented.
- Declared Elements persist with the Light store. Save declared writes Nightplot only. Apply to the controller is omitted as a working action (disabled, reason R4).
- Preview / Blink / All Off / Delete stay placeholders.

## 0.2.0 — R1 Discover + connect (CONFIG-2)

- Address probe and LAN find (mDNS / SSDP / optional `NIGHTPLOT_DISCOVERY_TARGETS`) are live. Public and other disallowed addresses are refused before any HTTP.
- Confirmed WLED candidates can be added. Rejects stay listed with a plain reason (`disallowed-address`, `probe-failed`, `not-wled`, `already-added`).
- Connect fails closed if a snapshot cannot be read. Duplicate host:port is refused. Enrolled Lights persist in `data/lights.json`.
- Lights home shows the rack plus an unenrolled tray. Unreachable enrolled Lights use grey beads and last-seen — never a stored last colour.
- Preview / Apply / All Off stay placeholders.
- Local WLED-shaped fixture: `pnpm fixture` on `127.0.0.1:48210`. Demo boot: `pnpm dev:demo`.

## 0.1.0 — R0 skeleton (CONFIG-1)

- TypeScript monorepo: `apps/web`, `apps/server`, `packages/shared`.
- Controller catalog registers WLED first. Strip catalog registers WS281x first. Discovery lists mDNS, SSDP, and address probe as placeholders. None of those members are wired; registered is not Hardware Done.
- Quiet-utility shell hosts the Lights empty state (v2 language). `StripBeads` draws the rail. All Off / Find Lights / Type an address are placeholders and send nothing to a strip.
- v2 design canvas committed at `docs/ui/` with open instructions.
- `AGENTS.md` and `docs/PLANE.md` record CONFIG ticket duties and naming.
- Dev boot on 43180 / 43181, plus `pnpm typecheck` and `pnpm test` smoke.
