# Nightplot Configure — v2 UI prototype

This folder is the visual source of truth for Quiet-utility Configure. The running app should follow it; it is not the running app.

## Files

| File | Role |
| --- | --- |
| `Nightplot Configure v2.dc.html` | Design canvas: Lights, Discover, Inspect, Edit ranges, Test live, All Off, Delete, seams |
| `support.js` | dc-runtime. Must sit next to the `.dc.html`. Do not edit by hand. |
| `web/public/logo-mark.svg` | Wordmark the prototype references as `web/public/logo-mark.svg` |

Attached originals were committed under these names. Keep `support.js` beside the HTML.

## How to open it

The prototype needs a local HTTP server **and** network access.

- `support.js` loads React 18, ReactDOM, and Babel from unpkg.
- The HTML pulls IBM Plex and Fraunces from Google Fonts.
- Opening the file via `file://` usually fails (script load / CDN).

From the repo root:

```bash
pnpm proto
```

That serves this directory on [http://127.0.0.1:43182](http://127.0.0.1:43182). Then open:

[http://127.0.0.1:43182/Nightplot%20Configure%20v2.dc.html](http://127.0.0.1:43182/Nightplot%20Configure%20v2.dc.html)

Any static server works:

```bash
python3 -m http.server 43182 --directory docs/ui
```

## What to take from it

- The strip is glowing LED beads on a dark rail, not chips or progress bars.
- Declared brackets sit above the beads; reported brackets sit below. Drift is a visible gap. Preview match counts are not those reported brackets.
- Unreachable beads are grey with last-seen copy. Never the last colour.
- Product words: Lights, Elements, Preview, Apply, Blink, All Off.
- Do not import Yard, Tonight, Studio, Scene, Show, Schedule, or Devices-as-noun chrome.
- Discover listed hosts follow `displayHost`: omit `:80` unless the port is not 80. A default-port not-WLED reject is `192.168.1.80`, not `192.168.1.80:80`.
- Espalexa `portWarning` copy and Lights last-seen / unknown-bead honesty are locked by `apps/web` component tests (`pnpm --filter @nightplot/web test`).

The prototype’s populated racks (Eave front, Porch rail, Garage) are direction frames. The running app only shows Lights that were enrolled. Inspect, Edit ranges, Test live, Apply, All Off, Delete, and Safe settings follow this bead language. A fixture readback is not Hardware Done.
