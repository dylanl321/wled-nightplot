# Constitution

Non-negotiables for Nightplot Configure. Product copy lives in [AGENTS.md](AGENTS.md). This file is the short list that a slice does not bargain away.

## What this is

The configure spine: discover → setup → visualize a strip (Elements / ranges) → live test → manage a few → All Off.

It is not a lighting control room. It does not host playback, mapping, or scheduling.

## Product words

Use: **Lights**, **Elements**, Preview, Apply, Blink, All Off.

Do not put these in chrome, routes, or user-facing copy: Yard, Tonight, Studio, Scene, Show, Schedule, Devices (as a noun).

A Light is one enrolled controller + one strip. An Element is a contiguous inclusive–exclusive range on that strip.

## Honesty

- Unreachable beads are grey, with last-seen copy. Never the last colour.
- Preview is not Apply.
- All Off cancels without restoring.
- Delete is a check that runs, not an “I understand” override on unknown.
- A registered catalog member is not Hardware Done. A stub endpoint must say it sent nothing.
- Fixture / software-green readback is not Hardware Done.

## Fail closed

Safe settings and first-time strip provision write only understood, fingerprinted fields. Empty fingerprint, unsupported firmware, multi-bus, or a type this table does not own → refuse. Nothing is written. A mismatch stays on the failure UI.

Find uses an advertised port (SSDP `LOCATION`, mDNS SRV) or leaves the row as needs host:port. Do not invent `:80` so a non-80 WLED looks addable.

Public internet addresses are refused before HTTP. See [SECURITY.md](SECURITY.md) and `decideProbeAddress` in `packages/shared/src/net/address.ts`.

## One code basis

Do not fork the Lights / Elements / live stack per vendor or strip type. New controllers or strip types register a catalog member. They do not rewrite the rack.

| Seam | First member | Home |
| --- | --- | --- |
| Controller | WLED | `packages/shared/src/controller/` |
| Strip / driver | WS281x | `packages/shared/src/strip/` |
| Discovery | mDNS / SSDP / address probe | `packages/shared/src/discovery/` |

`registered` means the slot exists. It is not Hardware Done. Capability flags stay false until that action is actually wired.

## Serial slices

Work the CONFIG series in order. R6 is Safe settings (the small `WledSafeSettings` set, fingerprint-gated). Gaps (CONFIG-9, CONFIG-11, CONFIG-45, …) are not the next R-slice. Do not start the next CONFIG ticket in the same run.

## Persistence

Fresh schema when persistence arrives. Do not migrate old Nightplot SQLite. Today’s store is `data/lights.json` (`FileLightsStore`).
