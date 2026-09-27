# Overview

Nightplot Configure is the **configure spine** for home LED strips: discover a controller, enroll it as a Light, describe Elements as ranges, Preview live, Apply, manage a few, All Off.

It is not a lighting control room. It does not host playback, mapping, or scheduling. It does not ship Yard, Tonight, Studio, Scene, Show, Schedule, or Devices-as-noun chrome.

The product is **not production-ready**. A fixture report is not Hardware Done.

## Words

- A **Light** is one enrolled controller + one strip (`packages/shared/src/lights.ts`).
- An **Element** is a contiguous inclusive–exclusive range on that strip.

Use: Lights, Elements, Preview, Apply, Blink, All Off.

## Spine

1. **Find** — mDNS, SSDP, typed address, optional `NIGHTPLOT_DISCOVERY_TARGETS`. Public IPs refused before HTTP.
2. **Enroll** — fails closed without a WLED snapshot. Persists in `data/lights.json`.
3. **Strip** — first-time WS281x type / length / GPIO via `/json/cfg` (`provision`). Named catalog presets fill the form; fields still override.
4. **Elements** — declare ranges. Save writes Nightplot only. Apply writes the controller, then re-reads. 200 only on match.
5. **Test live** — Preview and Blink. Preview is not Apply. Proof ladder: sent → controller reports → a person confirms.
6. **Safe settings** — small `WledSafeSettings` set, fingerprint-gated. Unsupported firmware is refused.
7. **Manage** — Lights rack, All Off (cancels without restoring), Delete (checks that run).

Catalog slice id is still `R6` (`CURRENT_SLICE` in `packages/shared/src/catalog.ts`). Later tickets (strip provision, presets, range reconcile) sit on that spine. They did not open a new control room.

## Honesty

- Unreachable beads are grey (`BeadColor` `"unknown"`), with last-seen. Never the last colour.
- Preview is not Apply.
- All Off cancels without restoring.
- Delete has no “I understand” override on unknown.
- A registered catalog member is not Hardware Done.

## Where to go next

| Doc | What |
| --- | --- |
| [install.md](install.md) | pnpm, ports, fixture |
| [deploy.md](deploy.md) | Docker / compose / GHCR. Not production certified |
| [architecture.md](architecture.md) | Tree, seams, symbols |
| [ui/README.md](ui/README.md) | v2 prototype |
| [PLANE.md](PLANE.md) | CONFIG tickets |
| [../CONSTITUTION.md](../CONSTITUTION.md) | Non-negotiables |
| [../README.md](../README.md) | Hub, API table, UI routes |
