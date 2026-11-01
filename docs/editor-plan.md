# Layout and path editor

This is the plan to approve before any editor rebuild. The hand-rolled pointer machine stays until this note is accepted.

A software drawing is not a lit strip. Preview is temporary. Apply persists. Not Hardware Done.

Checked on main `5eb47b0` by reading the editor, the section step, and Looks, and by opening the running app at 1440×900 and 390×844. A window path at 1440 puts the drawing on the left and turns Undo, Snap, Fit, Mark dark, and Add another string into hairline columns. The same path at 390×844 shows a normal bottom bar. Wheel on the desktop canvas did not zoom. There is no yard drawing at either size: Your yard is a checklist and a list of cards.

## Library comparison

The job is a measured drawing: polylines in metres, a few dozen corners, and thousands of pixels that must not each be a scene node. The library has to pan, zoom, pinch, drag a point, and hit-test a line. The document (strings, counts, sections, Looks) stays ours.

| Library | Pan, zoom, pinch | Drag and hit-test | Undo | About 15 controllers, thousands of pixels | Bundle (minified + gzip) | License | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **react-konva + konva** | Stage position and scale. Wheel and touch are ordinary events. Two pointers on the stage are a pinch. | Shape drag, `getIntersection`, events bubble. | Not included. The document stays in our types. | Draw one line per run and cache the pixel marks. Konva’s own guidance is that a canvas holds thousands of shapes if you do not put a node on every pixel. | konva 10 is about 52 kB. react-konva 19.2 is about 44 kB. | MIT | Use this. |
| Paper.js | `view` zoom and center | `hitTest`, strong path math | Not included | Fine if pixels are not items | paper 0.12 is about 82 kB | MIT | No official React binding. We would still write the shell. |
| Fabric.js | Viewport transform | Object model. The whole canvas redraws on a change. | Not included | Weaker at a busy yard | No official React binding. The package is an image editor, larger than Konva. | MIT | Wrong product shape. |
| @xyflow/react | Built in. It uses d3-zoom. | DOM nodes and SVG edges | Not included | A few hundred DOM nodes is the practical top. | About 59 kB | MIT | A flowchart. A run is a polyline, not a node. |
| tldraw | Full canvas, pinch, snap, its own tools | Shapes, bindings, its own undo | Included | DOM canvas, not a pixel map | SDK | Free to try. Production needs a license key. | We would be inside their whiteboard. |
| panzoom, or d3-zoom | Camera only | None | None | Depends on the drawing underneath | d3-zoom is about 15 kB. panzoom is a small helper. | ISC / MIT | Stops at the camera. Hit-testing and dragging would still be hand-built. That is the failure this plan leaves. |

xLights is the interaction reference, not a library. Its layout preview shows every model, you drag a model into place, and you zoom the preview. Each model has a start channel and a node count. A custom model is a grid of node numbers, with + and − to zoom. WLED’s ledmap is a JSON list from LED index to a cell, and a preset turns it on with `ledmap`. Both answer “which pixel is this”, not “how does the mouse work”. Addressing stays in `packages/shared`: section ranges become WLED segments, and a ledmap is only for a section that is not one contiguous range.

[dylanl321/nightplot](https://github.com/dylanl321/nightplot) already depends on `konva` and `react-konva`. `web/src/canvas/YardCanvas.tsx` is the pattern to follow, not a file to copy: wheel zoom toward the pointer, drag empty space to pan, grid snap, drag a shape, endpoint handles, and a label that includes the LED count. `web/src/designer/SiteViewport.tsx` is that repo’s measured site picture and is marked the primary editor there; the Konva yard is the legacy run path. Configure has no site picture. The Konva stage is the surface. Do not port the site viewport.

## Choice

**react-konva 19.2 and konva.** MIT. This app is on React 19.2, and react-konva 19.3 asks for React 19.3, so stay on the 19.2 line.

Konva owns the camera and the hit graph. Our types own the yard, the strings, the counts, and the sections. That is the same split as the original Nightplot canvas.

Left out on purpose:

- tldraw, because a production license is required and the product is a whiteboard.
- xyflow, because a run is not a node.
- Paper and Fabric, because they do not bind to React and the shell would be ours anyway.
- panzoom and d3-zoom by themselves, because they do not hit-test or drag.

## Use cases

These are the jobs the rebuilt editor has to finish, on a mouse at 1440×900 and on a finger at 390×844.

1. **See the yard.** Open Your yard with several props. Pan and zoom until the whole set is in frame, or zoom into one prop. Fit returns to the whole set. Nothing is sent to a controller.
2. **Place a prop.** Drag a prop on the yard to where it sits in the yard. Leave and come back: it is still there. Phone and desktop both drag.
3. **Open a saved path.** From a prop card, Edit opens the drawing, not a dead end. Back returns to the yard without pretending a save happened.
4. **Trace a string.** From the wire-in, add a run by clicking or tapping empty space. Add another run. The new run does not change the light count of the runs already there.
5. **Backtrack or go dark.** Continue onto a corner that already exists, including back over an edge. Mark the next run dark: the wire jumps and that run has no lights.
6. **Add another string.** Start a second string at its own wire-in. It is counted on its own.
7. **Move the shape.** Drag a corner. Snap holds it to the grid unless Alt is held. Undo puts the corner back. Redo puts the move back.
8. **Delete a run.** Select a run and delete it. Later runs stay. Undo restores it.
9. **Read every length.** Every run shows its length and its light count without opening a sheet first. Feet show feet. Metres show metres.
10. **Set a length.** Type 3 m on one run. The count becomes `round(3 ÷ spacing)`. The runs after it keep their own lengths. Their index numbers move because the edited run got longer or shorter.
11. **Override a count.** Type a light count on that run without retyping the length. The count is what sections and Attach use. A later length edit on that same run clears the override and counts from the length again.
12. **Return to sections.** On a prop that is already saved, open sections without recreating the prop. Add a section, rename it, give it a colour, put runs on it, take runs off, type a range such as 10–16, and delete the section. Save. Reopen: the sections are still there.
13. **A Look uses those sections.** In Looks, choose which sections belong to the Look and set a colour or effect on each. Save the library.
14. **That Look is what WLED receives.** Pushing the Look writes a preset whose segments are those section ranges, with the colour or effect chosen above. A section with no Look override uses the colour stored on the section. The push is read back. A mismatch is not success. Preview is not that push.

## Interaction

One stage. The world is metres. Stage scale and position are the camera. Screen to world is the stage transform inverted, not a second copy of the math.

| Action | Desktop (mouse and keyboard) | Phone (touch) | Today |
| --- | --- | --- | --- |
| Pan the yard or the path | Drag the background. Space-drag. Middle-button drag. | One-finger drag on the background, including while tracing. A tap that does not move still adds a point. | Edit mode pans on an empty drag. Trace treats that drag as a new point, so you cannot pan and trace with one finger. No space-drag. No middle-drag. No yard to pan. |
| Zoom | Wheel and trackpad pinch, toward the pointer. Buttons: zoom in, zoom out, Fit. | Pinch. The same three buttons. | Two-finger pinch exists in the gesture machine. No wheel. No zoom-in or zoom-out button. Fit exists. |
| Move a prop | Drag it on the yard. | Drag it on the yard. | No yard canvas. Props are cards. |
| Move a corner | Drag the handle. Arrow keys nudge the selected corner by one grid step. | Drag the handle. | Drag works in Edit. Arrow nudge exists only after a corner is selected. On a wide window the canvas is squeezed beside the broken tool column. |
| Add a run | In Trace, click empty space. The run starts at the current end. | Tap empty space. | Implemented for the path. Easy to miss on desktop because the tool column eats the screen. |
| Continue to a corner, or backtrack | Click an existing corner in Trace. | Tap that corner. | `continueToCorner` does this, including a second pass over an edge. |
| Dark run | Mark dark, then add the run. | Same control. | The button exists. On desktop it is one of the hairline columns. |
| Another string | Add another string, then click the wire-in. | Same. | `addStringAt` exists. Same chrome problem. |
| Select a run | Click the line. | Tap the line. | The tap sets the selected run. The length sits in a caption under the drawing, not on the run. |
| Delete a run | Delete or Backspace while the canvas is focused, and a Delete button. | The button. | No delete. |
| Undo / redo | Buttons, and Ctrl+Z / Cmd+Z, Shift for redo. | Buttons. | Buttons and the shortcut exist. |
| Length and count | A list of every run, beside the drawing: length, unit, count. Typing either one applies it. The drawing labels the run as well. | The same list under the drawing. | Order number on the drawing. Length and count only after you select the run and press Change. The count field only rewrites the length (`count × spacing`). There is no stored count override. `setEdgeLength` does move geometry, and section ranges are recomputed from the counts. |
| Snap | On by default. Alt while dragging turns it off for that drag. | A Snap button. | Snap and Alt exist. |
| Sections | From the saved prop, Name sections. Wide layout: drawing and the section list together, not a phone column floating in a 1440 window. | The current section step, full width. | The step can add, rename, recolour, toggle runs, type ranges, and remove a section. Edit on the card is the way back in. Desktop makes the path screen in front of it hard to use. |
| Look | Each section of each prop is a row: included or not, colour, effect. | Same rows, stacked. | Overrides are a wireframe group, a whole prop, a prop kind, or a Segment. A section cannot be named. `PropSection.color` is stored and the type says Looks do not read it. Attach does write that colour onto the segment. A later Look push replaces the preset from segments and prop-level overrides, so the section colour is not what the Look sends. |

Phone portrait keeps a bottom tool bar with 44 px targets. A wide window keeps the drawing on the left and the run list plus tools on the right, at a fixed width, not stretched across the monitor. The `landscape:` rule that restacks the phone tool bar on every wide window goes away. A short landscape phone can put that same tool column beside the drawing, with a real width, not a flex child shrunk to the text.

## What exists and what is missing

| Capability | Exists now | Missing |
| --- | --- | --- |
| Path model | Corners in metres, one or more strings, backtrack, dark runs, `round(length ÷ spacing)` per run. | Nothing in the model for this row. |
| Pan | Empty drag in Edit calls the pan effect. | Wheel-side pan (space, middle button). One-finger pan while tracing. Any pan of a yard. |
| Zoom | Pinch in `gestures.ts`. Fit button. | Wheel, trackpad pinch, zoom in, zoom out. |
| Drag a corner | Edit drag, snap, undo. | Usable on a wide window. The tool chrome covers the work. |
| Add, backtrack, dark, second string | Shared functions and buttons. | Delete a run. A wide-window layout that leaves the buttons clickable. |
| Length on every run | `edgeLengthM`, `countLayout`, a caption after you pick a run, a sheet that types a length. | The length and count visible without a tap. A stored light-count override (`lockedLights`). The sheet’s count field only changes the length. |
| Section edit | `PropSectionsStep` and Edit on the card. Add, rename, colour, runs, typed ranges, delete. Ranges move when counts change. Pinned ranges stay. | A desktop layout. Looks do not read the section. |
| Look → WLED | Preset build from segments. Override by prop, kind, segment, or wireframe group. Attach writes section colour onto the segment once. | Choose sections in the Look. Send that colour or effect as the preset segments. `sectionId` on an override. |
| Yard canvas | Checklist and prop cards. | A stage, a saved `{ x, y }` on the prop, drag. |
| Desktop chrome | Top bar from the `lg` breakpoint. Phone bottom bar hidden there. | The path screen uses `landscape:flex-row`, so 1440 and 1280 get the broken tool column. Confirmed at 1440×900. |
| Tests | Unit tests for counts, lengths, and section ranges. Phone overflow at 390 and 360. | No test that pans, zooms, drags a corner, sets 3 m, adds a coloured section, and saves a Look that uses it, at 1440 and at 390. |

## Keep and replace

Keep, in `packages/shared`:

- `PropLayout`, strings, `continueToPoint`, `continueToCorner`, dark runs, `countLayout`, `setEdgeLength`, section ranges, `planPropPlacement`, and `buildLookPreset`.
- Readback on a lasting write. A drawn length is not a lit strip.

Replace:

- The SVG scene and `gestures.ts` as the pointer layer. Pure helpers (grid snap, count, length) stay.
- The `landscape:` tool bar.

Add, only as far as the use cases require:

- `prop.yard` as `{ x, y }` in metres. Absent means a default slot, so props do not pile on one point.
- `lockedLights` on a run when the operator types a count. A length edit on that run clears it.
- `sectionId` on a Look override, resolved before prop, kind, and segment. The preset’s segments for that prop come from the section ranges.

## Build order

Do not start this until the plan is approved.

1. This plan, on its own.
2. Add konva and react-konva 19.2. One stage wrapper shared by both canvases: pan, zoom, pinch, Fit, zoom in, zoom out.
3. Prop path on that stage. Run list with length and count. Delete. Undo. Wide window and phone.
4. Yard stage. Drag a prop. Save `prop.yard`.
5. Sections from a saved prop, then a Look that names those sections, then the preset WLED would receive.
6. Playwright at 1440×900 and 390×844 for use cases 1, 7, 10, 12, and 13: pan, zoom, move a corner, set a run to 3 m and read the count, add a section and a colour, save a Look that uses it. The 1440 viewport joins the overflow check so the broken tool column cannot come back.

Acceptance for that last step is the same at both sizes: the control is visible, it takes the pointer, and the document changes in the way the use case says. A screenshot of the chrome is not the test.
