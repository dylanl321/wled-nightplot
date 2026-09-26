# Nightplot Configure

Leave-and-cut from Nightplot. This repo is the **configure spine** only: discover → setup → visualize a strip (Elements / ranges) → live test → manage a few → All Off.

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

## Architecture

One code basis. Do not fork the Lights / Elements / live stack per vendor or strip type.

| Seam | First member | Home |
| --- | --- | --- |
| Controller | WLED | `packages/shared/src/controller/` |
| Strip / driver | WS281x | `packages/shared/src/strip/` |
| Discovery | mDNS / SSDP / address probe | `packages/shared/src/discovery/` |

New controllers or strip types register a member. They do not rewrite the rack.

Layout:

- `apps/web` — Quiet-utility shell (Next.js)
- `apps/server` — catalogs, Discover/connect, JSON Light store, placeholder live actions
- `packages/shared` — types and catalogs
- `docs/ui/` — v2 prototype (visual source of truth)

Fresh schema when persistence arrives. Do not migrate old Nightplot SQLite.

## Slices

Work the CONFIG series in order. R5 is manage a few + All Off. Do not implement Safe settings (CONFIG-7 / R6) in the same run.

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
