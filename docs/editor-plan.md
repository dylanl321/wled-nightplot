# Layout and path editor

The current path editor draws an SVG and decides pan, zoom, hit-testing, and dragging in our own pointer state machine (`packages/shared/src/prop/gestures.ts` plus `prop-layout-editor.tsx`). That machine was written for a finger on a phone. On a desktop the same screen is `landscape`, so the tool rows become a broken side column, wheel zoom does not exist, and a click on empty space does not pan. Lengths, sections, and Looks are split across sheets that a mouse user cannot reliably open. This note picks a library that already does the interaction, and says what the editor has to do with it.

A software drawing is not a lit strip. Preview is temporary. Apply persists. Not Hardware Done.

## The job

One canvas component, two places:

| Place | What is on it |
| --- | --- |
| Yard | Every prop, in metres, where you put it. Drag a prop to move it. Pan and zoom the yard. |
| Prop path | One prop: one or more strings. Each string is an ordered run. A run can backtrack over a corner, or be dark (wire, no lights). |

Both places share pan, zoom, Fit, undo, and hit-testing. The path editor also does the rest:

- Drag a corner. Add a run from the wire end. Delete a run. Change a run (length, light count, lit or dark).
- Every run shows its length and its light count. Type a length in feet or metres, or type a light-count override. Later runs keep their own counts. Section index ranges move with the counts. A pinned range stays put.
- Sections: from a saved prop, add, rename, recolour, add or remove runs, type ranges, delete. The same sections are what a Look can include.
- A Look chooses which sections are in it and gives each a colour or effect. The preset sent to WLED is one segment per section range, with that style. A section colour with no Look override is the solid colour that gets sent. `PropSection.color` is stored today and Looks do not read it yet.

Light counts stay `round(length ÷ spacing)` unless that run has a count override. Equal sides stay equal. Adding a run does not change the others.

About 15 controllers and thousands of pixels must stay smooth. Draw a run as one line. Draw pixels as one cached mark per run, not one scene node per LED. Hit-test corners and runs, not every pixel.

## Libraries

| Library | Pan, zoom, pinch | Drag and hit-test | Undo | Thousands of pixels | Bundle (min+gzip) | License | Fit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **react-konva + konva** | Stage `x`/`y`/`scale`. Wheel and touch are normal events. Pinch is two pointers on the stage. | Shape drag, `getIntersection`, event bubbling. | Ours. The library does not own the document. | One line per run. Cache the pixel layer. Konva quotes about 5,000 shapes if you do not put a node on every LED. | konva 10 ~52 kB, react-konva 19.2 ~44 kB | MIT | Yes |
| Paper.js | `view` zoom and `view.center` | `hitTest`, path math | Ours | Fine if pixels are not items | paper 0.12 ~82 kB | MIT | No official React binding. We would still write the React shell. |
| Fabric.js | Viewport transform | Object model, whole-canvas redraw | Ours | Weaker: one canvas redraws on every change | Larger than Konva; no official React binding | MIT | Image editor, not a measured yard. |
| @xyflow/react | Built in (it uses d3-zoom) | DOM nodes and SVG edges | Ours | Falls over around a few hundred nodes | ~59 kB | MIT | A node graph. A prop is a polyline in metres, not a flowchart. |
| tldraw | Full infinite canvas, pinch, snap | Shapes, tools, bindings | Built in | DOM canvas; not a pixel map | SDK | Development is free. Production needs a license key. | A whiteboard product. We would be inside their editor, not ours. |
| panzoom or d3-zoom | Pan and zoom only | None | None | Depends on what you draw | d3-zoom ~15 kB; panzoom is a small helper | ISC / MIT | A camera. Hit-testing and dragging would still be hand-built, which is the failure we are leaving. |

xLights puts models on a layout preview: drag to place, zoom the preview, each model has a start channel and a node count. A custom model is a grid of node numbers. WLED’s ledmap is a JSON list from LED index to a cell, and a preset selects it with `ledmap`. Both are addressing, not a drawing library. We keep addressing in `packages/shared` (section ranges → WLED segments, and a ledmap only when a section is not one contiguous range). We do not draw with either tool.

[dylanl321/nightplot](https://github.com/dylanl321/nightplot) already depends on `konva` and `react-konva`. `web/src/canvas/YardCanvas.tsx` is the pattern to copy, not the file to vendor: wheel zoom toward the pointer, drag empty space to pan, grid snap, drag a shape, endpoint handles, and a label with the LED count. `web/src/designer/SiteViewport.tsx` is the measured site picture and is the primary editor there; the Konva yard is marked legacy in that repo. Configure does not have a site picture. The Konva stage is the right surface here. Do not copy the 80 kB site viewport.

## Choice

**react-konva 19.2 and konva**, MIT. React in this app is 19.2, and react-konva 19.3 asks for React 19.3, so stay on the 19.2 line.

Konva owns the camera and the hit graph. Our types own the yard, the strings, the counts, and the sections. That is the same split as the original Nightplot canvas, and it is the split Konva’s own guide recommends when the document is not a whiteboard.

Rejected on purpose:

- tldraw, because production needs a license and the product is a whiteboard.
- xyflow, because a run is not a node.
- Paper and Fabric, because they do not bind to React and we would rebuild the shell.
- panzoom and d3-zoom alone, because they stop at the camera.

## Interaction

One stage. The world is metres. The stage scale and position are the camera. `stage.getAbsoluteTransform().invert()` is the only screen-to-world conversion.

| Action | Desktop | Phone |
| --- | --- | --- |
| Pan | Drag the background. Space-drag. Middle-drag. | One-finger drag on the background. |
| Zoom | Wheel and trackpad pinch, toward the pointer. Buttons: zoom in, zoom out, Fit. | Pinch. Same three buttons. |
| Move a prop | Drag it on the yard. | Drag it on the yard. |
| Move a corner | Drag the handle. | Drag the handle. |
| Add a run | Click empty space in Trace, from the wire end. | Tap empty space in Trace. |
| Select a run | Click the line. | Tap the line. |
| Delete / undo | Buttons, and Delete / Backspace and Ctrl+Z or Cmd+Z when the canvas is focused. | Buttons. |
| Length | The selected run’s length and light count are in a list beside the drawing on a wide screen, and under it on a phone. Typing either one applies it. | Same list, under the drawing. |

Trace adds a point. Edit drags corners and pans from empty space. Snap stays on unless Alt is held. Dark marks the next run as wire. Another string starts at a new wire-in. Phone portrait keeps a bottom tool bar. A wide screen keeps the drawing on the left and the run list plus tools on the right. The `landscape:` rule that restacks the phone tool bar on every wide window goes away.

## Keep and replace

Keep, in `packages/shared`:

- `PropLayout`, strings, `continueToPoint`, `continueToCorner`, dark runs, `countLayout`, `setEdgeLength`, section ranges, `planPropPlacement`, and `buildLookPreset`.
- The rule that a lasting write is read back. A drawn length is not a lit strip.

Replace:

- The SVG scene and `gestures.ts` as the editor’s pointer layer. Geometry helpers that are still pure (snap to grid, count, length) stay.
- The phone-only tool chrome that uses `landscape:` as a stand-in for “short and wide”.
- Looks that cannot name a section. Add `sectionId` on a Look override. Resolve it before prop, kind, and segment. Build the preset’s segments from that prop’s section ranges when the prop has sections.

Add:

- `prop.yard` as `{ x, y }` in metres so a prop can sit on the yard canvas. Absent means a default slot, not “at the origin and overlapping everything”.
- `lockedLights` on a run when the operator types a count. Length edits clear it. Count edits set it and leave the drawn length unless the operator typed a length.

## Order

1. This plan, on its own, before more editor code.
2. Add konva and react-konva. One stage wrapper: pan, zoom, pinch, Fit, zoom in, zoom out. Used by both canvases.
3. Prop path on that stage: corners, runs, length list, delete, undo, wide-screen layout. Phone tool bar unchanged in structure.
4. Yard stage: place and drag props. Save `prop.yard`.
5. Sections stay editable from a saved prop. A Look can include a section and set its colour or effect. The WLED preset uses those ranges.
6. Playwright at 1440×900 and 390×844: pan, zoom, move a corner, set a run to 3 m and read the count, add a section and a colour, save a Look that uses that section. The same desktop size joins the overflow check so a wide window cannot ship the broken tool column again.
