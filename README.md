# Nightplot Configure

Configure spine for home LED strips. Discover a controller, enroll it as a **Light**, describe **Elements** as ranges on the strip, preview live, then Apply. All Off has a home.

This is not a playback desk. It does not ship Yard, Tonight, Studio, Scene, or Show chrome.

R1 wires Discover and connect. Preview, Apply, and All Off are still placeholders and do not talk to hardware.

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

or type `127.0.0.1:48210` on Add a Light and **Check and add**.

Enrolled Lights persist in `data/lights.json` (override with `NIGHTPLOT_STORE_PATH`). Find Lights also probes `NIGHTPLOT_DISCOVERY_TARGETS` (comma-separated `host` / `host:port`).

## API

| Method | Path | What |
| --- | --- | --- |
| GET | `/health` | Slice + liveness |
| GET | `/api/catalogs` | Controller / strip / discovery seams |
| GET | `/api/lights` | Enrolled Lights (live snapshot or grey + last-seen) and unenrolled tray |
| POST | `/api/discover` | LAN find (mDNS, SSDP, env targets). Does not enroll. |
| GET | `/api/discover` | Last find/probe rows |
| POST | `/api/discover/probe` | `{ host }` — one address. Public IPs refused before HTTP. |
| POST | `/api/lights` | `{ host }` — enroll. Fails closed without a WLED snapshot. Duplicate host → 409. |
| POST | `/api/preview` `/api/apply` `/api/all-off` | 501 placeholders |

## Layout

| Path | What |
| --- | --- |
| `apps/web` | Quiet-utility Lights rack, Discover, `StripBeads` |
| `apps/server` | Discover/connect, JSON store, WLED snapshot client |
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
