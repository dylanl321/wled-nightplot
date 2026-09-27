# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Slice lines (`0.7.x`) are not SemVer marketing numbers.

## Unreleased

### Added

- Strip attach for LED products (CONFIG-53): an enrolled Light stores `ledProductId` (null = manual fields). Strip lists the catalog; picking a product fills type / length / GPIO from that SKU and its driver. Fields still override. Attach is Nightplot bookkeeping — not Apply, not a WLED write, not Hardware Done. Apply stays fail-closed on existing WS281x provision. Presets remain as catalog seeds.
- Operator LED product catalog (CONFIG-52): Nightplot-owned SKUs (`id`, `label`, `notes`, `formFactor` discrete / cob / diffused, `driverId` against the strip driver catalog, optional channel / color-order / bead overrides or inherit from the driver, optional `defaultLength` / `defaultGpio` / `densityNotes`). JSON store `data/led-products.json` (`NIGHTPLOT_LED_PRODUCTS_PATH`). First boot seeds three WS281x rows from `STRIP_PRESETS`. `GET`/`POST /api/led-products` and `GET /api/led-products/:id`; `GET /api/catalogs` includes `ledProducts`. Fail closed on unknown `driverId`, bad `formFactor`, or bad defaults. Form factor is metadata — not written to WLED. A catalog row is not Hardware Done. Strip UI attach is CONFIG-53.
- Docker image, compose, and GHCR workflow (CONFIG-45). One image (`api` / `web` / `all`); `docker-compose.yml` runs web + api in a shared network namespace with a lights-store volume. Bind `0.0.0.0` and optional `NIGHTPLOT_CORS_ORIGINS` are env-gated for containers — `pnpm dev` stays loopback. Find multicast from a container often fails; `docker-compose.host.yml` is the Linux host-network path. Typed address still works. The image packages local/LAN run; there is no auth or TLS.
- Repo documentation and governance files (CONFIG-44): README hub, CONTRIBUTING, CONSTITUTION, SECURITY, MIT LICENSE, `docs/overview.md` / `install.md` / `deploy.md` / `architecture.md`, GitHub issue and PR templates. Docker / compose / GHCR landed in CONFIG-45.

### Changed

- `docs/PLANE.md` lists filed CONFIG tickets through CONFIG-50 and records the live GitHub home `dylanl321/wled-nightplot` with package name `nightplot-configure` (CONFIG-34).
- Public docs describe Nightplot Configure as a standalone LAN utility (CONFIG-50). README and overview open with what the product is, who it is for, and how to run it. Lights, Elements, Preview, Apply, Blink, and All Off are defined in positive vocabulary. Early-software facts (LAN, no auth, no TLS, fixture is a development stub) replace documentation-about-documentation meta.

### Fixed

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
