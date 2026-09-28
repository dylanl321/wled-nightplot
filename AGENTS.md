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
- `docs/ui/` — v2 prototype (visual source of truth)

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
