# Overview

Nightplot Configure is a LAN utility for home LED strips on WLED. Find a controller, enroll it as a **Light**, describe **Elements** as ranges on the strip, **Preview** colour on the beads, then **Apply**. **Blink** identifies a box. **All Off** lives on the rack.

It is early software. There is no authentication and no TLS. A fixture report is a development stub, not proof that a real strip passed.

## Words

- A **Light** is one enrolled controller + one strip (`packages/shared/src/lights.ts`).
- An **Element** is a contiguous inclusive–exclusive range on that strip.
- **Preview** is temporary colour and brightness; it restores (or cancels without restore). Restore writes power, brightness, colour, and ranges only when the last snapshot knew them — an info-only report does not invent on, brightness 128, `#ffa000`, or a whole-strip segment.
- **Apply** writes the controller and re-reads. Success only on match. Unknown colour refuses — Apply does not invent `#ffa000`. Unknown reread segments are not treated as empty and are not a match. Write-failed and reread-failed do not invent an empty `apply.read` — unread stays `null`, not `[]`. Unknown pre-apply segment count does not invent 0 leftover-segment clears — Apply refuses until a count is known. The failure panel uses that reread message — unknown is not **Apply didn’t stick**. Unread / unknown-read captions do not say the controller reported ranges — caption follows the read, not the source. A known reread still does. **Use controller’s** is only offered when that reread named ranges.
- **Blink** is an identify pulse.
- **All Off** cancels live sessions without restoring, then powers off enrolled Lights. Probes up to four Lights at a time; each Light is listed by what it reported. Unknown stays unknown.

## Flow

1. **Find** — mDNS, SSDP, typed address, optional `NIGHTPLOT_DISCOVERY_TARGETS`. Public IPs refused before HTTP. If Find fails to load, enrolled Lights stay listed — that is not a claim the configure server is down. Retry Find Lights or type an address.
2. **Enroll** — fails closed without a WLED snapshot. Persists in `data/lights.json`.
3. **Strip** — first-time type / length / GPIO via `/json/cfg` (`provision`). Mapped types are WS281x RGB and SK6812 RGBW. Converting a bus to SK6812 RGBW writes GRBW (WLED `order` 0). A length or GPIO Apply that keeps the same type leaves the colour order already on the box, and Strip names that live order — including when an SK6812 bus is not GRBW. A catalog LED product fills the form from that SKU and its driver; fields still override. Attach persists `ledProductId` on the Light and does not write WLED. Unknown types and unsupported firmware are refused — a write-build refuse 422 includes `provisionWrite` so Strip shows the failure panel. There is no colour-order picker.
4. **Elements** — declare ranges. Save writes Nightplot only. Apply writes the controller, then re-reads. 200 only on match. Unknown pre-apply segment count refuses leftover-segment clears — nothing is written.
5. **Test live** — Preview and Blink. Preview is temporary; Apply is what persists. Proof ladder: sent → controller reports → a person confirms.
6. **Safe settings** — small `WledSafeSettings` set, fingerprint-gated. Unsupported firmware is refused.
7. **Manage** — Lights rack, All Off (cancels without restoring; up to four Light probes at a time), Delete (checks that run). If one Light’s Inspect cannot load, enrolled Lights stay listed — that is not a claim the configure server is down.

The catalog slice id is `R6` (`CURRENT_SLICE` in `packages/shared/src/catalog.ts`). Strip provision, named presets (seeds), LED product attach, and range reconcile sit on that same flow. Operator LED products (`LedProduct`) are a Nightplot catalog of specific SKUs — form factor, driver, optional defaults — stored in `data/led-products.json`. Attaching one to a Light stores `ledProductId`. That is not a WLED write and not Hardware Done.

## Honesty

- Unreachable beads are grey (`BeadColor` `"unknown"`), with last-seen. Never the last colour. Missing `on` after an info-only snapshot is the same class: **Online · unknown**, unknown-grey beads — not “Online · off”. Missing `state.seg` is the same class: **segments unknown**, not “0 segments”. A known empty `seg` stays 0. Unknown segments are not compared as an empty report — drift waits until `state.seg` is known. Apply reread skips the match compare when segments are unknown — it does not coalesce `null` to `[]`. Write-failed and reread-failed use that same unread `null` — they do not invent `[]`. Their ApplyFailed caption does not say the controller reported ranges when that read is unknown. A known reread still does. Apply leftover-segment clears refuse when that count is unknown — they do not invent 0. The Edit-ranges failure panel shows that unknown-reread message; it does not say the write didn’t stick. Strip Apply failure titles from the provision write message (cfg mismatch or refuse) — it does not say didn’t-stick for those. A `buildProvisionWrite` refuse 422 includes `provisionWrite` so that panel is shown — not a notice-only line. Edit ranges does not mark those Elements as matches. It also does not label the selected Element **seg** until a report exists — the kind chip says **no compare**. Invert and past strip use the same words as the list row — not generic overlap. Overlap and drift still win when those apply. **Use controller’s** after a failed Apply takes only that reread’s known ranges — unknown or empty is not a last-known adopt. A detail miss on Inspect does not paint a last colour or claim the list is down.
- RGB vs RGBW on Inspect and the Lights rack follows the attached LED product or the persisted strip driver — not a hardcoded WS281x label from `/json/info` `leds.rgbw`. Opening Inspect on a Light that still has the default driver and no product may persist a known `/json/cfg` bus type (the same mapping as Strip). The Lights list does not read cfg. RGBW beads show two dies (colour + white). That is not Hardware Done.
- Preview is temporary. Apply persists. Preview restore does not invent on, brightness, colour, or a whole-strip segment from an info-only snapshot. Known empty `seg: []` restores as empty. Apply refuses when colour is unknown — it does not invent `#ffa000`.
- All Off cancels without restoring. An unknown row names the wait that happened, or a generic refuse — not a claimed 3 s.
- Delete has no “I understand” override on unknown. Unknown controller copy names the wait that happened, or a generic refuse — not “in time”.
- A registered catalog member is a slot in the table. It is not proof hardware passed. A stub endpoint must say it sent nothing.

## Where to go next

| Doc | What |
| --- | --- |
| [install.md](install.md) | pnpm, ports, fixture |
| [deploy.md](deploy.md) | Docker / compose / GHCR on a LAN |
| [architecture.md](architecture.md) | Tree, seams, symbols |
| [ui/README.md](ui/README.md) | v2 prototype |
| [PLANE.md](PLANE.md) | CONFIG tickets |
| [../CONSTITUTION.md](../CONSTITUTION.md) | Non-negotiables |
| [../README.md](../README.md) | Hub, API table, UI routes |
