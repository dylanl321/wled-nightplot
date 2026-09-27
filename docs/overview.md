# Overview

Nightplot Configure is a LAN utility for home LED strips on WLED. Find a controller, enroll it as a **Light**, describe **Elements** as ranges on the strip, **Preview** colour on the beads, then **Apply**. **Blink** identifies a box. **All Off** lives on the rack.

It is early software. There is no authentication and no TLS. A fixture report is a development stub, not proof that a real strip passed.

## Words

- A **Light** is one enrolled controller + one strip (`packages/shared/src/lights.ts`).
- An **Element** is a contiguous inclusive–exclusive range on that strip.
- **Preview** is temporary colour and brightness; it restores (or cancels without restore).
- **Apply** writes the controller and re-reads. Success only on match.
- **Blink** is an identify pulse.
- **All Off** cancels live sessions without restoring, then powers off enrolled Lights.

## Flow

1. **Find** — mDNS, SSDP, typed address, optional `NIGHTPLOT_DISCOVERY_TARGETS`. Public IPs refused before HTTP.
2. **Enroll** — fails closed without a WLED snapshot. Persists in `data/lights.json`.
3. **Strip** — first-time WS281x type / length / GPIO via `/json/cfg` (`provision`). Named catalog presets fill the form; fields still override.
4. **Elements** — declare ranges. Save writes Nightplot only. Apply writes the controller, then re-reads. 200 only on match.
5. **Test live** — Preview and Blink. Preview is temporary; Apply is what persists. Proof ladder: sent → controller reports → a person confirms.
6. **Safe settings** — small `WledSafeSettings` set, fingerprint-gated. Unsupported firmware is refused.
7. **Manage** — Lights rack, All Off (cancels without restoring), Delete (checks that run).

The catalog slice id is `R6` (`CURRENT_SLICE` in `packages/shared/src/catalog.ts`). Strip provision, named presets, and range reconcile sit on that same flow. Operator LED products (`LedProduct`) are a Nightplot catalog of specific SKUs — form factor, driver, optional defaults — stored in `data/led-products.json`. They are not written to WLED. Attaching a product to a Light is a later ticket.

## Honesty

- Unreachable beads are grey (`BeadColor` `"unknown"`), with last-seen. Never the last colour.
- Preview is temporary. Apply persists.
- All Off cancels without restoring.
- Delete has no “I understand” override on unknown.
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
