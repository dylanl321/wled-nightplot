# Shape-aware effects

Effects that follow a prop's shape instead of light 1, 2, 3: chase the well's border while its X breathes, run light from every corner into the middle, fill a tree from the ground up. The full design, with WLED limits and the route to stock-WLED presets, is the "Shape-aware lighting animations" doc (https://claude.ai/artifact/TwvKEnhuzPMAr5vnGQDtvk).

## The plan

0. A one-day bench test (ESP32 and ESP8266, WLED 0.15 and 16.x) of ledmap switching, missing maps, bucket grids and interleaving with grouping. It gates steps 3 and 4 only. **Not run.** The checklist is in "Slice 0 bench checklist" below.
1. **Shape reader** — `packages/shared/src/prop/shape.ts`. This slice.
2. **Shape on the Looks page** — the Shape panel (`apps/web/src/components/looks/shape-panel.tsx`, `packages/shared/src/prop/shape-design.ts`). Sections from the shape, a motion per section, and copying a design to sections and props of the same kind. Saves an ordinary Look.
3. Recipes on ledmaps: one combined map per Look per controller, face map included.
4. Bucket-map effects: one ledmap row per ring or height band, run in 1D "Bar" mode, so whole rings light at once (Ripple, rain by real height).
5. A usermod, only for whatever is still missing.

## The shape reader

`readPropShape(layout, { overrides })` reads the drawing and writes nothing.

1. Lights come from `stringLights()`, so hand-placed lights sit where they were put.
2. Corners within the editor's weld tolerance (`nearCorners` rule) become one point. Runs are split where another run ends on them or crosses them, so a star drawn as crossing lines gets its inner points.
3. Faces are traced over the lit runs. The walk with no area inside is the outside; runs on it are the outline. Dark (wire) runs are left out of faces.
4. Each light is border or inside on its own, by straight-line distance to the outline, rounded to one light spacing. A run can be part border, part inside.
5. A point's kind is how many runs meet: end, corner or bend, junction. A turn is measured about one light spacing out, so a curve traced in short pieces reads as bends.
6. The outline is cut into sides at corners, ends and junctions, named Top, Bottom, Left, Right, or a slope.
7. Mirror lines through the centre count when 90% of lights land within half a spacing of another light.

Per-light fields, each 0–1, are also inputs to the effect grammar (`EFFECT_SHAPE_FIELDS`):

| Name | Meaning |
| --- | --- |
| `x`, `y` | Position, scaled by the larger side (Pixelblaze "Contain") |
| `r` | Distance from the centre |
| `a` | Angle around the centre, clockwise from up |
| `d` | Distance along the runs from the centre junction (else the wire-in); dark runs add distance |
| `along` | Place on its own run, in metres |
| `ring` | Depth inside the outline; 0 is the border |
| `h` | Height from the lowest light |

`sampleShapeEffect` samples a definition over a prop's lights with these fields. A frame sampled without a shape reads them as 0.

Groups: `border`, `inside`, `side.N`, `corners`, `corner.N`, `ends`, `centre`. A person's fix (`ShapeOverride`) is keyed by run id or light id so a redraw keeps it. Fixes are stored on the prop as `Prop.shapeRoles`.

Known limits: a separate shape drawn inside another (not joined to it) reads as its own outline; `PropLayout.faces` is still not written.

## The Shape panel

Pick one prop on a Look. Under its sections, **Shape** shows the reader's summary and a drawing: border lights amber, inside lights teal, rings at corners, a cross at the centre. The section being edited is drawn larger.

- **Fix it.** Tap a light to switch its whole run between border and inside. The fix is saved on the prop (`shapeRoles`, by run id), and **Clear N fixes** removes them.
- **Sections from the shape.** *Border and inside* makes two sections. *Each side and part* makes one per side (Top, Right, Bottom, Left, or slopes) and one per inside run. A run that is all in one group is kept by run id; a run split between groups gets pinned ranges. Replacing existing sections asks first. A Light keeps its old segments until the prop is attached again.
- **Which way it travels.** On a prop or section with its own style: Along the wire, Toward the centre, Out from the centre, Clockwise, Counter-clockwise, Upward, Downward. Nightplot reads the trend of `r`, `a` or `h` along the lights and picks WLED's direction: forward, reversed, mirrored (both ends to the middle) or mirrored and reversed (middle out). When no direction fits, it says so. The choice is saved as `LookStyle.motion` beside `dir`.
- **Use this design on.** A section's style can be copied to sections of the same kind: same role (border or inside), same form (line, path or loop), closest size first. Each copy works its own direction out from its own drawing, so a diagonal wired the other way still runs toward the centre.
- **Use the design on similar props.** On the whole prop, props with the same pieces are listed, and their sections get the matching section's style.

`pnpm --filter @nightplot/web test:shape` walks this in a browser at 1440×900 and 390×844.

## Slice 0 bench checklist (for Dylan)

Nothing here has been run. Slice 2 of `docs/hang-to-effects.md` pushes a light map per motion with the Looks, and the sim and fixture (`apps/server/src/wled-fixture-box.ts`) only check that Nightplot writes and rereads the files it means to. They are not WLED, so **no real board has been tried and every default below is pending this bench.** Until it is done, a Look push with maps is not Hardware Done.

Run each row on an **ESP32** and an **ESP8266**, on **WLED 0.15.x** and on **16.x**. Use a strip of at least 300 lights (and a 1000-light strip for the size row), pushed from a branch with slice 2. Write what you see in the Result column, with the board, WLED version and date.

| # | Check | How | What Nightplot assumes | Result |
| --- | --- | --- | --- | --- |
| 1 | Maps load | Push two Looks with different motions. Open `http://<light>/ledmap.json` and `/ledmap1.json`. | Each file is there and is the map Nightplot reread. | |
| 2 | Switching | Recall the Look on map 1, then the Look on map 2, then the one on map 0 (preset numbers, from the Now bar or the WLED page). | Each preset changes the light order at once, with no reboot and no stale order from the last map. | |
| 3 | Map 0 with no file | Delete `ledmap.json` on the board (WLED `/edit`), then recall a Look that sets `"ledmap": 0`. | Map 0 with no file clears the map back to wire order. If it keeps the last map, the Off preset and playlists need another answer. | |
| 4 | Missing map file | Delete `ledmap2.json`, then recall the Look that names it. | The Look runs in wire order and nothing crashes. If it does not, Nightplot must refuse a preset whose file it cannot reread. | |
| 5 | Nine maps | Push ten Looks that need nine different orders. | Maps 1 to 9 all load and the tenth is refused by Nightplot. | |
| 6 | 300 and 1000 lights | Push a map of 300, then of 1000 lights. | Both load without a watchdog reset or a slow first frame. Note the free heap on the WLED info page. | |
| 7 | Map length | Push a map shorter than the strip, then longer. | WLED copes. Nightplot only writes a map the length of the Light. | |
| 8 | Group banding | In a Look on a height-sorted map set `grp` to the typical lights per ring and run Chase. | Each step lights a whole band. Write the `grp` that worked. | |
| 9 | Interleaving | Use `grp` and `spc` on a sorted map beside a segment with none. | They band as expected and the other segment is unchanged. | |
| 10 | Segments on a map | Run a Look with three segments in map positions, one with `rev`. | The segment ranges are map positions, and `rev` reverses inside that range. | |
| 11 | Preview over a map | While a Look on map 1 is saved, Preview another Look. | Preview ignores the saved map (Preview does not send `ledmap`) and runs along the wire. Say what it does. | |
| 12 | Survive a reboot | Power-cycle the board. | The maps and the Look's map are still there. | |

Slice 2 defaults that wait on this bench:

- **Nine maps** per Light beside the base map (checks 1, 5, 6).
- **`grp` banding** instead of a band map (checks 8 and 9). If it fails, slice 7 (band maps) is needed.
- **Map switching behaviour**: a preset names its map with `"ledmap"`, every Look sets it, and Off and playlists set `"ledmap": 0` (checks 2 to 4, 11).
