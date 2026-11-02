# Shape-aware effects

Effects that follow a prop's shape instead of light 1, 2, 3: chase the well's border while its X breathes, run light from every corner into the middle, fill a tree from the ground up. The full design, with WLED limits and the route to stock-WLED presets, is the "Shape-aware lighting animations" doc (https://claude.ai/artifact/TwvKEnhuzPMAr5vnGQDtvk).

## The plan

0. A one-day bench test (ESP32 and ESP8266, WLED 0.15 and 16.x) of ledmap switching, missing maps, bucket grids and interleaving with grouping. It gates steps 3 and 4 only.
1. **Shape reader** — `packages/shared/src/prop/shape.ts`. This slice.
2. Recipes on segments: a picker on the Looks page that saves an ordinary Look.
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

Groups: `border`, `inside`, `side.N`, `corners`, `corner.N`, `ends`, `centre`. A person's fix (`ShapeOverride`) is keyed by run id or light id so a redraw keeps it. Storing fixes on the prop and showing the groups on the drawing come next.

Known limits: a separate shape drawn inside another (not joined to it) reads as its own outline; `PropLayout.faces` is still not written.
