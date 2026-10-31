# Constitution

Non-negotiables for Nightplot Configure. Product copy lives in [AGENTS.md](AGENTS.md). This file is the short list that a slice does not bargain away.

## What this is

A LAN utility for a yard of WLED controllers: Find them, enroll them as Lights, describe each controller’s outputs and Segments, Preview live, Apply, manage a fleet, All Off.

## Product words

Use: **Lights**, **Segments**, Preview, Apply, Blink, All Off.

Fleet and show words are also in play: **Yard**, **Prop**, **Zone**, **Look**, **Schedule**.

A Light is one enrolled controller. It may drive several outputs (WLED buses). A Segment is an inclusive–exclusive range on one output. Gaps between Segments are allowed; overlap is not.

Existing `Element` types and `elements` store keys stay compatible.

## Honesty

- Unreachable beads are grey, with last-seen copy. Never the last colour.
- Preview is temporary. Apply persists.
- All Off cancels without restoring.
- Delete is a check that runs, not an “I understand” override on unknown.
- A registered catalog member is a slot in the table. It is not proof hardware passed. A stub endpoint must say it sent nothing.
- The local fixture is a software stub for development. A green readback there is not Hardware Done.
- A headless sim/e2e lane is a software path only. It is not Hardware Done. Metal benches stay human.
- Unknown is not empty. A missing read is not a successful write.
- Lasting writes are readback-verified. Mismatch is not success.

## Fail closed

Safe settings and strip provision write only understood, fingerprinted fields. Empty fingerprint, unsupported firmware, or a type this table does not own → refuse that write. Nothing is written for that field set. A mismatch stays on the failure UI.

Multi-bus is not a refuse. Read and write every `hw.led.ins[]` entry this table understands; clone the rest. Analog / network / multi-pin buses stay listed and are not converted.

Bulk writes take an automatic background backup and prefer one Undo over a blocking confirm. Fail closed per controller: one dead box does not stop the rest.

Find uses an advertised port (SSDP `LOCATION`, mDNS SRV) or leaves the row as needs host:port. Do not invent `:80` so a non-80 WLED looks addable.

Public internet addresses are refused before HTTP. See [SECURITY.md](SECURITY.md) and `decideProbeAddress` in `packages/shared/src/net/address.ts`.

## One code basis

Do not fork the Lights / Segments / live stack per vendor or strip type. New controllers or strip types register a catalog member. They do not rewrite the rack.

| Seam | First member | Home |
| --- | --- | --- |
| Controller | WLED | `packages/shared/src/controller/` |
| Strip / driver | WS281x | `packages/shared/src/strip/` |
| Discovery | mDNS / SSDP / address probe | `packages/shared/src/discovery/` |

`registered` means the slot exists. It is not Hardware Done. Capability flags stay false until that action is actually wired.

## Serial slices

Work the CONFIG series in order. R6 is Safe settings (the small `WledSafeSettings` set, fingerprint-gated). Gaps are not the next R-slice. Do not start the next CONFIG ticket in the same run.

GitHub epic slices may change fleet behaviour. They still do not fold adjacent CONFIG gaps into the same run.

## Persistence

Enrolled Lights, outputs, and declared Segments persist in `data/lights.json` (`FileLightsStore`). A missing `outputs` row migrates to one output from `ledCount` / `stripKind`. Operator LED products persist in `data/led-products.json` (`FileLedProductsStore` list / create / update). Setup profiles persist in `data/setup-profiles.json`. The LED product catalog is the shared type / IC recipe. Length, GPIO, Segment ranges, and field overrides live on the Light / output. Catalog edit mutates the recipe only — it does not write WLED. Strip-assist helpers do not replace catalog attach. Attach is not Apply. A catalog row is not Hardware Done.
