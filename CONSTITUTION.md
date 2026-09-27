# Constitution

Non-negotiables for Nightplot Configure. Product copy lives in [AGENTS.md](AGENTS.md). This file is the short list that a slice does not bargain away.

## What this is

A LAN utility: discover a WLED controller, enroll it as a Light, describe Elements as ranges on the strip, Preview live, Apply, manage a few, All Off.

## Product words

Use: **Lights**, **Elements**, Preview, Apply, Blink, All Off.

A Light is one enrolled controller + one strip. An Element is a contiguous inclusive–exclusive range on that strip.

## Honesty

- Unreachable beads are grey, with last-seen copy. Never the last colour.
- Preview is temporary. Apply persists.
- All Off cancels without restoring.
- Delete is a check that runs, not an “I understand” override on unknown.
- A registered catalog member is a slot in the table. It is not proof hardware passed. A stub endpoint must say it sent nothing.
- The local fixture is a software stub for development. A green readback there is not Hardware Done.

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

Work the CONFIG series in order. R6 is Safe settings (the small `WledSafeSettings` set, fingerprint-gated). Gaps are not the next R-slice. Do not start the next CONFIG ticket in the same run.

## Persistence

Enrolled Lights and declared Elements persist in `data/lights.json` (`FileLightsStore`). Operator LED products persist in `data/led-products.json` (`FileLedProductsStore`).
