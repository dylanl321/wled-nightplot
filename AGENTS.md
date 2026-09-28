# Nightplot Configure

Nightplot Configure is a LAN utility: discover a WLED controller, enroll it as a **Light**, describe **Elements** as ranges on the strip, Preview live, Apply, manage a few, All Off.

## Product words

Use: **Lights**, **Elements**, Preview, Apply, Blink, All Off.

A Light is one enrolled controller + one strip. An Element is a contiguous inclusive–exclusive range on that strip.

Use this product’s vocabulary. Do not invent alternate product nouns (control room / scenes / schedules / etc.).

## Honesty

- Unreachable beads are grey, with last-seen copy. Never the last colour.
- Preview is temporary. Apply persists.
- All Off cancels without restoring.
- Delete is a check that runs, not an “I understand” override on unknown.
- A registered catalog member is a slot in the table. It is not proof hardware passed. A stub endpoint must say it sent nothing.
- A sim enroll is software path only. Fixture software-green is not strip lit. Neither is Hardware Done.

## Architecture

One code basis. Do not fork the Lights / Elements / live stack per vendor or strip type.

| Seam | First member | Home |
| --- | --- | --- |
| Controller | WLED | `packages/shared/src/controller/` |
| Strip / driver | WS281x | `packages/shared/src/strip/` |
| Discovery | mDNS / SSDP / address probe | `packages/shared/src/discovery/` |

Find must use an advertised port (SSDP LOCATION, mDNS SRV) or leave the row as needs host:port. Do not invent `:80` so a non-80 WLED looks addable.

New controllers or strip types register a member. They do not rewrite the rack.

Layout:

- `apps/web` — Quiet-utility shell (Next.js)
- `apps/server` — catalogs, Discover/connect, JSON Light store, live / Apply / provision / Safe / All Off
- `packages/shared` — types and catalogs
- `docs/ui/` — bead-language prototype. The running shell is the v3 top bar (Lights, LED products, All Off; Elements and Settings on a Light).

The store is `data/lights.json`.

## Slices

Work the CONFIG series in order. R6 is Safe settings (the small WledSafeSettings set, fingerprint-gated). Gaps (CONFIG-9, CONFIG-11, …) are not the next R-slice. Do not start the next CONFIG ticket in the same run.

See `docs/PLANE.md` for Plane coordinates, REST-only rules, state ids, and comment duties.

## Agent duties on CONFIG-*

- REST to `{PLANE_URL}/api/v1` with `X-API-Key`. Never `api.plane.so`. Never Plane MCP.
- In Progress + start comment before the first code edit.
- Milestone / blocker comments as you go.
- CHANGELOG and public docs land in the **same commit** as the code they describe.
- Adjacent bugs and gaps: Plane comment as intake stubs. Do not stuff them into the current slice.
- Done + completion comment only when the ticket’s done-when is actually met.

## Checks

```bash
pnpm test
pnpm typecheck
pnpm dev
```

Web: `http://127.0.0.1:43180`  
API: `http://127.0.0.1:43181`

## Learned User Preferences

- Prefer Corepack to activate the root `packageManager` pnpm pin; avoid the standalone pnpm installer, which can rewrite that pin to a Corepack-incompatible version.
- Element range-mismatch copy must be plain and operator-meaningful; opaque “reports N more LEDs than declared” deltas that thrash while editing do not communicate.
- In the Element editor, offer a way to keep other Elements lit while scrubbing or scrolling individual nodes.

## Learned Workspace Facts

- Find must send mDNS and SSDP on each non-loopback IPv4 except `169.254.0.0/16`. Joining multicast on every interface is not enough if the query still leaves through the OS default adapter.
- mDNS Find rows are only `_wled._tcp` SRV records. Other services heard on the link are not WLED candidates and must not be probed.
- Background Find: while Nightplot is open, scan immediately then about once a minute while the tab is visible; pause when hidden. Find Lights still forces a scan.
- LED product geometry: `pitchMm` (discrete/diffused, centre-to-centre) or `sectionLengthMm` (COB section) yields calculated length on Lights, Light, Element, and Strip pages. Voltage, watts, IP, width, cut length, and density notes stay under Advanced and do not affect length.
