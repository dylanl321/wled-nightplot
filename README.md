# Nightplot Configure

Configure spine for home LED strips. Discover a controller, enroll it as a **Light**, describe **Elements** as ranges on the strip, preview live, then Apply. All Off has a home.

This is not a playback desk. It does not ship Yard, Tonight, Studio, Scene, or Show chrome.

R3 wires Test live: temporary Preview and Blink, with `/json/live` readback. Apply to the controller and All Off orchestration are still later tickets.

## Run

Needs Node 20+ and [pnpm](https://pnpm.io).

```bash
pnpm install
pnpm dev
```

- App: [http://127.0.0.1:43180](http://127.0.0.1:43180)
- API: [http://127.0.0.1:43181](http://127.0.0.1:43181)

```bash
pnpm typecheck
pnpm test
```

### Discover → Add without a box on the LAN

`pnpm fixture` serves a WLED-shaped `/json` at `127.0.0.1:48210`. Then either:

```bash
pnpm dev:demo
```

or type `127.0.0.1:48210` on Add a Light and **Check and add**. Open the Light for Inspect, then **Edit ranges** to declare Elements, then **Test live** to Preview or Blink. Save declared writes the store only. Preview restores; Apply to the controller is R4. The fixture `/json/live` path is a software stub — not Hardware Done.

Enrolled Lights and declared Elements persist in `data/lights.json` (override with `NIGHTPLOT_STORE_PATH`). Find Lights also probes `NIGHTPLOT_DISCOVERY_TARGETS` (comma-separated `host` / `host:port`).

## API

| Method | Path | What |
| --- | --- | --- |
| GET | `/health` | Slice + liveness |
| GET | `/api/catalogs` | Controller / strip / discovery seams |
| GET | `/api/lights` | Enrolled Lights (live snapshot or grey + last-seen), declared Elements, unenrolled tray |
| GET | `/api/lights/:id` | Inspect payload: identity, declared Elements, reported segments, drift, live session |
| GET | `/api/lights/:id/live` | Same Light plus current `/json/live` beads |
| PATCH | `/api/lights/:id/elements` | Save declared ranges. 422 on invert / overlap / over-ledCount. Does not write WLED. |
| POST | `/api/lights/:id/preview` | Temporary colour/brightness on one Element. Reads `/json/live`. |
| POST | `/api/lights/:id/preview/end` | Restore previous look (`restore: false` is the All Off contract, unused here). |
| POST | `/api/lights/:id/preview/seen` | Person rung: `{ seen: "yes" \| "no" }`. Not Hardware Done. |
| POST | `/api/lights/:id/blink` | Identify pulse. Restore with `/blink/end` (UI does this after 3 s). |
| POST | `/api/discover/blink` | `{ host }` — pulse a candidate, then restore. |
| POST | `/api/discover` | LAN find (mDNS, SSDP, env targets). Does not enroll. |
| GET | `/api/discover` | Last find/probe rows |
| POST | `/api/discover/probe` | `{ host }` — one address. Public IPs refused before HTTP. |
| POST | `/api/lights` | `{ host }` — enroll. Fails closed without a WLED snapshot. Duplicate host → 409. |
| POST | `/api/apply` `/api/all-off` | 501 — Apply is R4; All Off is R5 |

## UI

| Path | What |
| --- | --- |
| `/` | Lights rack + unenrolled tray |
| `/discover` | Find / type an address / add |
| `/lights/:id` | Inspect — identity + StripBeads + declared vs reported |
| `/lights/:id?mode=ranges` | Edit ranges — draft save, overlap/invert/over-ledCount block save |
| `/lights/:id?mode=live` | Test live — Preview / Blink, proof ladder, `/json/live` beads |

## Layout

| Path | What |
| --- | --- |
| `apps/web` | Quiet-utility Lights rack, Discover, Inspect / Edit ranges / Test live, `StripBeads` |
| `apps/server` | Discover/connect, JSON store, WLED snapshot + Preview/Blink + fixture `/json/live` |
| `packages/shared` | LAN guard, WLED parse, catalogs, Light / Element types |
| `docs/ui/` | Nightplot Configure v2 prototype. See [docs/ui/README.md](docs/ui/README.md). |
| `docs/PLANE.md` | CONFIG tickets, REST-only Plane duties. |

## Prototype

```bash
pnpm proto
```

Then open [http://127.0.0.1:43182/Nightplot%20Configure%20v2.dc.html](http://127.0.0.1:43182/Nightplot%20Configure%20v2.dc.html).

## Publishing this draft

This Origin draft **is** Nightplot Configure. When you create the GitHub repository, name it **`nightplot-configure`**.

Plane project: Configure (`CONFIG`) in workspace `nightplot`. See `docs/PLANE.md`.
