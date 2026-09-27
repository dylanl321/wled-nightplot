# Nightplot Configure

Configure spine for home LED strips. Discover a controller, enroll it as a **Light**, describe **Elements** as ranges on the strip, preview live, then Apply. All Off has a home.

This is not a playback desk. It does not ship Yard, Tonight, Studio, Scene, or Show chrome.

R6 wires the small Safe settings set on an enrolled Light, gated by the firmware’s `/json/cfg` fingerprint. Unsupported firmware is refused — nothing is written. After a display-name write, the rack title uses the `/json/cfg` name even when metal `/json/info` still lags until reboot.

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

`pnpm test` includes `apps/web` component tests (Vitest + Testing Library): Espalexa `portWarning` copy on Discover / the unenrolled tray, and Lights last-seen / unknown beads with Inspect Refresh as the one-Light probe. The list component does not re-probe.

### Discover → Add without a box on the LAN

`pnpm fixture` serves a WLED-shaped `/json` at `127.0.0.1:48210`. Then either:

```bash
pnpm dev:demo
```

or type `127.0.0.1:48210` on Add a Light and **Check and add**. Open the Light for Inspect, then **Edit ranges** to declare Elements, then **Apply**, **Test live** to Preview or Blink, or **Safe settings** for the small `/json/cfg` set. **All Off** is on the rail / thumb bar. **Remove this Light** on Inspect runs three checks and refuses until they complete. The fixture is a software stub — not Hardware Done.

By default the fixture updates `/json/info` and `/json/cfg` together. Real metal often keeps the old `/json/info` name until reboot. To simulate that lag: `NIGHTPLOT_FIXTURE_INFO_NAME_LAG=1 pnpm fixture`, or `POST http://127.0.0.1:48210/nightplot/info-name-lag` with `{ "on": true }`. Safe settings rename still updates the rack title from cfg. `{ "on": false }` copies cfg → info.

**Ports.** Find uses a real advertised port: SSDP `LOCATION`, mDNS SRV. It does not assume `:80`. A host with no port from find is listed as needs host:port — it is not Add-able. Typed address is the escape hatch (a typed host with no port still means `:80`). Listed hosts use `displayHost` and hide default `:80` (a not-WLED reject on port 80 is `192.168.1.80`, not `192.168.1.80:80`). The fixture is **not** on 80; type `127.0.0.1:48210` or use the demo target list.

Enrolled Lights and declared Elements persist in `data/lights.json` (override with `NIGHTPLOT_STORE_PATH`). Find Lights also probes `NIGHTPLOT_DISCOVERY_TARGETS` (comma-separated `host` / `host:port` — include the port when it is not 80). Find probes up to **four** collected hosts at a time; a host that does not answer is `probe-failed` in about 3 s and does not block the rest of the scan.

## API

| Method | Path | What |
| --- | --- | --- |
| GET | `/health` | Slice + liveness |
| GET | `/api/catalogs` | Controller / strip / discovery seams |
| GET | `/api/lights` | Enrolled Lights (live snapshot or grey + last-seen), declared Elements, unenrolled tray |
| GET | `/api/lights/:id` | Inspect payload: identity, declared Elements, reported segments, drift, live session |
| GET | `/api/lights/:id/live` | Same Light plus current `/json/live` beads |
| PATCH | `/api/lights/:id/elements` | Save declared ranges. 422 on invert / overlap / over-ledCount. Does not write WLED. |
| POST | `/api/lights/:id/apply` | Write declared ranges, re-read snapshot. 200 only on match. 409 keeps the failure. |
| POST | `/api/lights/:id/readdress` | `{ host }` — probe first, same-MAC continuity, persist address + last-good snapshot. |
| POST | `/api/lights/:id/preview` | Temporary colour/brightness on one Element. Reads `/json/live`. |
| POST | `/api/lights/:id/preview/end` | Restore previous look (`restore: false` cancels without restore). |
| POST | `/api/lights/:id/preview/seen` | Person rung: `{ seen: "yes" \| "no" }`. Not Hardware Done. |
| POST | `/api/lights/:id/blink` | Identify pulse. Restore with `/blink/end` (UI does this after 3 s). |
| POST | `/api/discover/blink` | `{ host }` — pulse a candidate, then restore. |
| POST | `/api/discover` | LAN find (mDNS, SSDP, env targets). Probes up to four collected hosts at a time. Does not enroll. |
| GET | `/api/discover` | Last find/probe rows |
| POST | `/api/discover/probe` | `{ host }` — one address. Public IPs refused before HTTP. |
| POST | `/api/lights` | `{ host }` — enroll. Fails closed without a WLED snapshot. Duplicate host → 409. |
| POST | `/api/apply` | 400 — use `/api/lights/:id/apply` |
| POST | `/api/all-off` | Cancel live sessions without restore, then `{ on: false }` each enrolled Light. Body `{ lightIds }` retries only those. |
| GET | `/api/lights/:id/delete-checks` | Elements / live sessions / controller state. Unknown is not safe. |
| DELETE | `/api/lights/:id` | 422 until every check is `ok`. Does not write the controller. |
| GET | `/api/lights/:id/safe` | Fingerprinted Safe settings from `/json/cfg`. Empty fingerprint → refuse. |
| POST | `/api/lights/:id/safe` | `{ settings }` — write only understood fields, then reread. 422 if unsupported. A matched display-name write patches the enrolled title from cfg even when `/json/info` still lags. |

## UI

| Path | What |
| --- | --- |
| `/` | Lights rack + unenrolled tray. All Off on the rail / thumb bar |
| `/discover` | Find / type an address / add |
| `/lights/:id` | Inspect — identity + StripBeads + declared vs reported + Delete checks |
| `/lights/:id?mode=safe` | Safe settings — name, boot, transition, current limit; refuse if unsupported. A rename updates the title from `/json/cfg` without waiting for reboot. |
| `/lights/:id?mode=ranges` | Edit ranges — draft save, Apply write+reread, failed Apply stays |
| `/lights/:id?mode=live` | Test live — Preview / Blink, proof ladder, `/json/live` beads |

## Layout

| Path | What |
| --- | --- |
| `apps/web` | Quiet-utility Lights rack, Discover, Inspect / Edit ranges / Test live / Safe settings, All Off, Delete, `StripBeads` |
| `apps/server` | Discover/connect, JSON store, WLED snapshot + live + Apply + All Off + Delete + Safe settings + fixture |
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
