# Nightplot Configure — UI notes

The running shell is the v3 top bar in `apps/web`: Lights, LED products, and Backups in the bar, All Off on the bar (thumb bar below `lg`), Segments and Settings on a Light, strip-map cards on Lights.

This folder keeps the earlier v2 bead-language prototype. It is not the running app.

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
- RGBW (SK6812 or an attached RGBW product) grows a second die on each bead and is captioned RGBW. RGB stays one die. That caption follows the product or driver — not a hardcoded WS281x RGBW chip from snapshot `rgbw`. Inspect may persist a known cfg bus type when the Light still has the default driver and no product.
- Declared brackets sit above the beads; reported brackets sit below. Drift is a visible gap. Preview match counts are not those reported brackets.
- Unreachable beads are grey with last-seen copy. Never the last colour. Missing `on` after an info-only snapshot is the same class: Online · unknown and unknown-grey, not Online · off. Missing segments are **segments unknown**, not 0 segments. Unknown segments do not compare as empty rails — drift waits until the report is known. Apply reread does not treat unknown segments as empty and does not call that a match. Write-failed and reread-failed do not invent an empty `apply.read` — unread stays unknown, not `[]`. Unread / unknown-read ApplyFailed captions do not say the controller reported ranges. A known empty reread says **reported no ranges**, not **these ranges**. Its Hardware Done suffix is **until you look at the strip**, not **until you see them**. A known non-empty reread still does. Apply leftover-segment clears refuse when the count is unknown — they do not invent 0. The running Apply failure panel uses that reread message (unknown is not **Apply didn’t stick**). The running Strip failure panel uses the provision write message (cfg mismatch or refuse is not **Apply didn’t stick**). A `buildProvisionWrite` refuse 422 includes `provisionWrite` so that panel is shown — not a notice-only line. A `buildSafeWrite` refuse 422 includes `safeWrite` the same way. Safe settings shows that panel (Sent / Read back) and hides the notice while it is up. A Safe settings or Strip GET/load refuse uses the form banner once — it is not also a notice line, and the caption is not repeated under the form. The 2d canvas still shows the known-mismatch example. Edit ranges rows say **no compare**, not matches, until that report exists. The selected-Element kind chip says **no compare**, not **seg**. Invert and past strip use the same words as the list row and the bead legend red key — not generic overlap. That red key only appears when invert, past strip, or overlap is present. The dashed drift key only appears when drift is present and compare is meaningful — not when every Element matches or compare is refused. The v2 Edit-ranges canvas (#2d) legend uses that same gate from the framed scene (this scene has overlap and drift). The keys are not a permanent always-on demo set. An inverted range whose start is already past the strip (80–40 on 60 LEDs) is invert and past strip — not invert only. Overlap and drift still win when those apply. **Use controller’s** on the running Apply failure panel is only offered when the reread named ranges. Preview restore does not invent on, brightness 128, `#ffa000`, or a whole-strip segment from that unknown. Apply refuses when colour is unknown — it does not invent `#ffa000`.
- Product words: Lights, Elements, Preview, Apply, Blink, All Off. Use this product’s vocabulary.
- Discover listed hosts follow `displayHost`: omit `:80` unless the port is not 80. A default-port not-WLED reject is `192.168.1.80`, not `192.168.1.80:80`.
- All Off unknown-row copy is actual elapsed or generic **no answer from {host}.** — the v2 Garage example uses the generic string, not an invented 3 s wait.
- Delete unknown-controller copy is actual elapsed or generic **Couldn’t read it** — the v2 Porch rail unknown example uses the generic string, not “in time”.
- Espalexa `portWarning` copy and Lights last-seen / unknown-bead honesty are locked by `apps/web` component tests (`pnpm --filter @nightplot/web test`).

The prototype’s populated racks (Eave front, Porch rail, Garage) are direction frames. The running app only shows Lights that were enrolled. Inspect, Strip (first-time WS281x or SK6812 RGBW / length / GPIO via cfg, plus a catalog LED product that fills those fields), Edit ranges, Test live, Apply, All Off, Delete, and Safe settings follow this bead language. On Elements, **Light on strip** is Preview locate: hover and drag hops coalesce (latest LED, skip a no-op) and do not refresh the bead strip on every hop. A hop updates the open Preview session — it does not take a new restore snapshot, and it does not claim a live report unless one was read. The controller write is one black underlay plus the lit pieces; a hop that only moved the cursor posts that one segment. A gap cursor between Elements reuses overlay ids for unchanged ranges so later Elements are not rewritten. First locate open clears leftover controller ids above the overlay picture when the snapshot count is known. Unknown restore segment count captions that leftovers were not cleared — it does not invent a count or call leftover lights this locate. Inspect Refresh keeps that unknown leftover caption while the first-locate Preview is open — leftover lights do not become a live-read / fixture line. Leaving overlay for a named-Element or Blink Preview clears leftover overlay ids we authored. End Preview restore after overlay also `stop: 0`s leftover overlay ids we authored. Apply is refused as soon as Show is on. Preview is not Apply. Convert to SK6812 RGBW writes GRBW (`order` 0); a same-type length or GPIO Apply keeps the colour order already on the box, and Strip names that live order — including when it is not GRBW. Strip does not pick colour order. A length-changing Strip Apply must not leave declared Elements claiming they still match — clip / drop / flag, then the re-read drift story. A fixture readback is not Hardware Done. A sim enroll is software path only — not Hardware Done. Preview is not Apply. Attaching a product is not Apply. The catalog product is the shared type / IC recipe (managed on `/led-products`); length, GPIO, ranges, and overrides stay on that Light. Catalog delete refuses while Lights still attach that recipe; unknown or partial attach counts are not safe. Strip-assist helpers do not replace catalog attach.
