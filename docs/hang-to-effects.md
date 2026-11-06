# Hang-to-effects workflow

Spec, Nov 6, 2026 (Dylan). This is a plan to agree before more code. Slice 1, the motion map builder, slice 2, pushing its maps with the Looks, and and slice 6, Yard check and the season file across every map, are built and checked in tests and against the sim and fixture, which are not WLED. Neither has run on a real board, so the slice 2 defaults wait on the slice 0 bench in `docs/shape-aware-effects.md`. Every other slice is still a plan.

A software drawing is not a lit strip. Preview is temporary. Apply persists. Not Hardware Done.

## The need

Hang lights on a tree, bush or object in whatever order is easiest on the ladder, tell the app where they ended up, and have every effect run by position (bottom to top, centre out, around) with no regard for the wire order. In Dylan's words: a string may go up the trunk, up one branch, across mid-air to another, down that one, and a second string may go up a third branch, and a fill should still rise from the ground to the top. One bush may be wrapped vertically and the next horizontally, and the same Look must read the same on both.

The promise the app makes, stated so the code can be checked against it:

1. **Hang first, describe second.** No wiring plan is required before the lights go up. The app accepts any number of strings, in any order, with dark jumps between branches.
2. **Describe it in minutes, not a 3D model.** A front-on drawing with rough positions is enough, or a few taps on an iPhone at the prop. Height, distance from the centre and angle only need to be right to about one light spacing.
3. **Effects follow the drawing, not the wire.** A motion such as upward, outward or clockwise means the same thing on every prop, whatever its wiring.
4. **It runs with Nightplot closed.** Shows are WLED presets and timers, so the position logic has to land on the controller, not stream from the server.
5. **Honest readback.** What the controller holds is reread and compared, and a mismatch is not success (per AGENTS.md).

## The workflow, end to end

Five steps. The person only touches the first three. The last two are the app's job.

1. **Hang.** Put strings on the tree, bush or object however is easiest. Note nothing except which controller output each string plugs into.
2. **Capture.** Tell the app the shape of what was done: lit runs and dark jumps, one string at a time. Three ways in, and all end as the same prop drawing:
   - **Scan it (iPhone).** Stand at the prop with the Nightplot iPhone app. Tap the points that define the shape where they really are: a spiral's first and last wrap and the trunk's width, a split tree's base, forks and tips, a window's corners, the bends of a roofline. The app sends the numbers, and the server builds the prop from the same templates the browser uses. (New.)
   - **Trace it.** Tap the corners the string passes on the drawing, as today. Good for anything that follows an edge, and for fixing a scan.
   - **Walk it.** The controller lights every Nth bulb in turn and the person taps where that bulb is on the drawing. Lights in between are spread along the line. For a bush stuffed by hand where no template fits. (New, optional.)
3. **Attach.** Say which output and start light each string sits on. Every string gets a home, not only the first. (Partly new.)
4. **Design.** On the Looks page pick a motion for the prop or a section: Upward, Out from the centre, Clockwise, Along the wire. Pick effects and colours as now. The preview shows the motion on the drawing.
5. **Run.** Push writes one light map per motion to each controller and a preset per Look that names its map. WLED then runs stock effects in position order, with Nightplot closed. (New.)

What the person never has to do: wire in a planned order, measure with a tape, split sections to suit the wiring, or pick forward and reverse by hand.

## What the code does today

Checked on main at `f79a337` (2026-11-06). Capture and understanding are mostly there. Rendering on the controller is where the promise stops.

| Step | What exists | Where |
| --- | --- | --- |
| Capture: trace | Runs are lit, wire (dark jump) or hidden, on any number of strings, each with its own wire-in. Lights can be placed by hand on a run. Reverse, mirror, set wire-in, repeat, scale. | `packages/shared/src/prop/layout.ts` (`PropLayout`, `LayoutString`, `PlacedLight`), `prop/commands.ts` (PR #188) |
| Capture: templates | Spiral and zigzag wraps, split tree with wraps up each trunk and dark hops between, well house, roofline, window, arch, tree outline. | `prop/wraps.ts`, `prop/split-tree.ts`, `prop/split-pose.ts`, `prop/templates.ts` |
| Capture: from numbers | `POST /api/props` takes either a drawing (`layout`) or `measurements` and builds the drawing on the server. Measurements cover spiral (`height`, `around`, `aroundTop`, `gap`), window, roofline, arch, zigzag and split tree (including a hand-placed `pose`). | `apps/server/src/prop-setup-routes.ts`, `PropMeasurements` in `prop/types.ts` |
| Capture: lit cursor | The old Add prop wizard steps a lit cursor along the real strip ("Walk the strip") and the person taps each corner. The one-page editor has no such mode. | `apps/web/src/components/props/add-prop.tsx` (`walkFrame`), `POST /api/lights/:id/blink` |
| Understand | The shape reader gives every light, on every string, position fields that ignore wire order: `x`, `y`, `r` (from centre), `a` (angle), `d` (along the wires), `ring` (depth from the border), `h` (height), each 0 to 1. Border or inside, corners, sides, mirror lines. A person's fixes are kept on the prop. | `prop/shape.ts` (`readPropShape`), `Prop.shapeRoles` in `prop/types.ts` |
| Preview | The effect grammar can sample a definition over those fields. The Looks page draws a Look on the yard with WLED-like colours. | `effect/evaluate.ts` (`sampleShapeEffect`), `look-preview.ts`, `look-design.ts` |
| Design | Shape panel: sections from border, inside and sides; a motion per section (Along the wire, Toward the centre, Out, Clockwise, Counter, Upward, Downward); copy a design to similar sections and props. | `apps/web/src/components/looks/shape-panel.tsx`, `prop/shape-design.ts` |
| Yard position | A prop's spot is `x` along the house, `y`, `depth` out from the wall, `facing` and `heightM`. Every light gets a yard x, y, z from it. | `PropYardPoint` in `prop/types.ts`, `prop/space.ts`, `PATCH /api/props/:id/yard` |
| Attach | Each string of a prop is placed on its own output at its own start light (slice 3, software only). Segments are one per section range of that string, or one per edge. A string can start after another string, of this prop or another. | `prop/design.ts` (`planPropPlacement`, `segmentsForProp`, `propStrings`), `apps/server/src/prop-setup-routes.ts` |
| Run | A Look is one WLED preset per Light with one segment per section range. Before slice 2, motion became the segment's `rev` and `mi` flags only and the only light map written was the well-house face map. Since slice 2 a push writes one `ledmapN.json` per distinct motion order, each Look's preset names its map, and a section's range is its place in that map. | `look.ts` (`buildLookPreset`, `mapTargetsForLook`, `propSectionPlan`), `prop/light-maps.ts` (`planLightMaps`), `apps/server/src/wireframe-persist.ts` (`writeAndVerifyLedmap`), `apps/server/src/look-routes.ts` |
| Readback | Yard check compares the wireframe map digest and the managed preset slots (the presets now include each Look's `ledmap`, so a Light pushed before slice 2 reads as different until it is pushed again). `lastLedmap` is a list, one row per map file written; an older single value reads as the base map. Slice 6 compares every map file. | `yard.ts` (`compareLedmap`), `lights.ts` (`lastLedmap`) |

`docs/shape-aware-effects.md` planned five steps. Steps 1 and 2 shipped (PR #179, #181). Step 0 (a bench test of map switching on real boards), 3 (maps per Look) and 4 (band maps) have not been started.

## Where it breaks against the need

Seven gaps, checked in the code. The first two are the ones Dylan's tree hits first.

1. **Effects still run along the wire on the controller.** A motion is turned into forward, reversed or mirrored on one segment (`prop/shape-design.ts`, `directionForMotion`). A section whose height goes up, then down, then up again is reported as mixed with the note "split it into its parts". Even split, each segment restarts its effect, so a fill is not one fill across the tree. Before slice 2, `look.ts` said it outright: one effect across separate ranges needs a ledmap, which Nightplot did not write for sections. That note is gone; the maps are written.
2. **Only the first string is attached (closed by slice 3, software only).** Before slice 3, `planPropPlacement` in `prop/design.ts` places one output and one start, and `segmentsForProp` drops ranges on other strings. `propSectionPlan` in `look.ts` adds a note that those lights were not sent. A tree with a second string up a third branch is half dark on the controller. `PropAttachment` in `prop/types.ts` had no string id. Now it has an optional `stringId` (absent is the first string, so every old row reads as before) and `afterStringId`; each string has its own row, output and start, fit is checked per string, and Segments are written per string. The note is gone once every string is attached, and stays only for a string that is not.
3. **Capture means drawing by eye.** Every shape is typed or drawn in the browser. A spiral's height and girth, or where a split tree's forks really are, has to be measured with a tape or guessed. The lit-cursor walk is only in the old wizard; the one-page editor (`yard-editor/`) has no way to see which bulb is which while drawing.
4. **Only one light map, only for the well house.** `writeAndVerifyLedmap` in `apps/server/src/wireframe-persist.ts` writes `/ledmap.json` for the first wireframe prop and nothing else. `WriteWledLedmap` in `wled/native-backup.ts` takes no file name. Presets built by `buildLookPreset` never set the `ledmap` key, so WLED keeps whatever map was last loaded.
5. **Preview and controller disagree (closed by slice 4, software only).** `sampleLookStyle` in `look-design.ts` applies direction to the index along the wire, which matches what WLED does today. Once maps exist, the preview must sample in map order or the yard drawing will lie.
6. **Readback covers one map (closed by slice 6, software only).** `compareLedmap` in `yard.ts` and `Light.lastLedmap` in `lights.ts` hold one digest. Several maps per Light need several digests, and the season file (`season.ts`, `ledmapJson`) kept one string.
7. **Depth is dropped.** On main, `LayoutCorner` and `SplitPoseNode` are `x` and `y` only. The spiral and split-tree templates compute a true 3D coil (`helixPoint` and the split-tree samples return `z`) and then keep only the front-on drawing plus `wrapLengthM`. Open PR #192 adds an optional `LayoutCorner.z` on split-tree coil corners, carries it through `layoutLightPoints` and `placeYardLight`, and uses it in `shape.ts` only to keep the front and back of a coil apart where they cross. Even with #192, `ShapeFields` has no depth, run lengths are measured in 2D, and `a` is the angle around the centre of the picture. Upward and Out are right. Clockwise on a wrapped tree sweeps across the front view, not around the trunk.

**Not a gap: the shape reader.** `readPropShape` already walks every string (`stringLights` in `layout.ts`) and gives `h`, `r` and `a` per light, so the sort order for any motion is already computable for any wiring, including dark jumps and a second string.

## The design: motion maps on stock WLED

One idea carries the whole thing: a **motion map** is a WLED ledmap that lists a controller's lights in the order an effect should visit them, sorted by a shape field instead of by wire. WLED runs its ordinary 1D effects over that order, so Upward is a Chase sorted by height and Out from the centre is the same Chase sorted by distance from the centre. Nothing new runs on the board, and shows still run with Nightplot closed. No usermod, no live streaming.

### How a map is built, per Light and per Look

1. Take every prop attached to the Light, every string included, with the shape reader's fields per light.
2. Lay the props out in attach order, each prop a block. Inside a prop, each section is a block too, so a section is still one contiguous WLED segment.
3. Sort each block by the motion chosen for it: Upward by `h`, Out from the centre by `r`, Clockwise by `a`, Along the wire by wire index (no change). Toward the centre, Downward and Counter-clockwise reuse the same sort with the segment's `rev` flag, which keeps the map count down. Ties (lights at the same height) are broken by angle, then by wire index, so neighbours stay neighbours.
4. A well-house face map keeps its own packing inside its block, so the current wireframe behaviour is unchanged.
5. The result is one array, one entry per physical light, each light once. The map is written as `ledmapN.json`, the Look's preset sets `"ledmap": N`, and its segments use positions in that map rather than the physical Segment ranges.

**As built in slice 1.** `buildMotionMaps` in `packages/shared/src/prop/motion-map.ts` takes the props on one Light with the physical index each starts at, and a motion per section per Look (a motion for the whole prop covers a section with none, and a section with neither runs along the wire). Each prop's block covers its own lights, so lights outside a prop keep their place, and props that share lights are refused. A well house (a prop with a wireframe) packs its face map in its block, and its Look sections are not reported. Lights in no section form one more block, so every light appears once. The result lists maps by slot (0 is the base), each Look's slot, and every section's range in map positions with its `rev` flag. Slice 1 alone wrote nothing to a controller.

**As built in slice 2.** `planLightMaps` (`packages/shared/src/prop/light-maps.ts`) is the caller. For one Light it finds where each Prop starts (its attachment, an "after another prop" chain, or its Segments for older props; the output's offset is added), checks the drawing against the attached light count, and gives the builder each Look's motions. A Look whose sections all follow their Prop sorts the Prop as one block, so a fill runs across the whole Prop; a Look that styles one section keeps each section its own block. Any Prop with a drawing is mapped, whatever its kind, and several can share a Light. A well house is a block in the base map, has no sections, and ignores a motion. The push refuses before anything is written when the drawing and the attached count disagree, when a Prop does not fit on the Light, or when more than nine other maps are needed. It then writes `ledmap.json` and `ledmapN.json`, rereads and compares each (stopping at the first that fails), and only then writes presets. A Light whose Looks all run in wire order and has no well house gets no new map file; if an older `ledmap.json` may be there (the record has one, or the controller returns one that is not a straight pass-through) a straight base map is written over it and reread first, since every preset names map 0. If a write fails partway, the message names the files already written and they stay in the `lastLedmap` record; no presets are sent. Apply writes the base map only. Preview does not send `ledmap`, so it paints through whichever map the last recalled preset loaded, not necessarily along the wire. Known gap: End Preview restores segments and brightness, not a map number, so Preview cannot safely switch maps until the slice 0 bench shows how. Yard check and the season file are slice 6. This was run in tests against the sim and fixture, not on a board.

**As built in slice 4.** `lookPreviewOrder` (`packages/shared/src/look-order.ts`) asks the same builder the push uses (`buildMotionMaps`, fed by the same `motionsFor` and sorted by `motionSort`) for one Prop at light 0, and reads back, for each drawn light, its section, its place in that section's order, the block size and the segment's `rev`. `sampleLookStyle(style, index, count, t, order?)` then takes that order: with `{ rev }` it uses the map's `rev` and ignores `dir` and `mi`, exactly as `mapTargetsForLook` does when it sends `rev` from the map; without it the old wire-order, `dir` behaviour stays. The yard (`yard-canvas.tsx` through `drawnLightColour`) and `lookFrame` use it, for any Prop kind and any strings, so a zigzag bush, a two-string split tree, a window frame or a custom trace all draw the order their map writes, ties and all. It returns nothing, and the drawing stays along the wire with the style's `dir` (what `directionForMotion` stored), when the Look has no map for that Prop: every motion is Along the wire, the Prop is left out of the Look, it has no drawing or is a wireframe, the map cannot be built, or the motion's map is the plain wire order (the push then sends physical ranges with `dir`). A section set to Along the wire inside a mapped Look stays in wire order. Tests in `packages/shared/src/look-order.test.ts` check, for all six motions plus Along the wire, on a zigzag bush, a two-string split tree, a window frame and a spiral, that the drawn order equals the map the builder writes and that the motion's field only grows (or shrinks, when reversed) along it. This is a software drawing, not a lit strip, and not Hardware Done. Preview on lights still paints through whichever map the last recalled preset loaded (slice 2's known gap), so the yard drawing shows what a saved Look does after the push, and Preview on a Light may differ until slice 0. The drawing assumes every string of a Prop is attached; a string left unattached is not in the controller's map.

**As built in slice 6.** Yard check rereads every map file a push would write now (`planLightMaps`, so `ledmap.json` plus each `ledmapN.json`) and `compareLedmap` (`packages/shared/src/yard.ts`) compares them one by one. Any file that differs, or is not on the controller, makes the Ledmap row a mismatch and the row names the files (a difference in `ledmap2.json` shows even when `ledmap.json` is right). A file that did not read, or is not a map, is unknown and never a match. When the controller still holds what the last push wrote, the row says the drawing or the Looks have changed since. When Nightplot's record lists only `ledmap.json` (a Light pushed before motion maps, whose record was one value) and more files are expected, the row says so and asks for a push; it is not a silent mismatch. When no map is needed the row still checks that a leftover `ledmap.json` does not bend the wire order, since every preset names map 0. The push now records what is on the controller after a failure: a file that reread as a different map is recorded with the digest of what was read, and a file whose write or reread failed is dropped from `lastLedmap` rather than left claiming the old map. The season file keeps `SeasonDeviceFiles.ledmapJson` as a string holding `ledmap.json` (slot 0) and adds `SeasonDeviceFiles.ledmaps`, a list of `{ slot, json }` for every map file the controller returns, so an older build still loads the device row and its cfg and presets (it restores only the base map). A missing or unreadable file is left out, and the export result (`message`, `ledmapUnread`) names the Lights and files that did not read. The export reads the ten slots in parallel. In the no-map-needed case, a Light that did not answer or a `ledmap.json` that did not reread is unknown, never a match; only a 404 is a match. A season file with one string loads as slot 0, and a `lastLedmap` that is one value in a season file, a backup or a restore loads and is written back as the list. Restore does not write map files to a controller; the re-push rebuilds them from the Props and Looks. Tested against the sim and fixture box (`apps/server/src/yard-ledmap.test.ts`), including a mismatch in a non-zero slot. Not run on a board.

**Capacity.** WLED loads `ledmap.json` (0) and `ledmap1.json` to `ledmap9.json`, chosen per preset with the `ledmap` key (WLED JSON API, WLED mapping). Maps are deduplicated across the Looks library, so a yard whose Looks use Upward, Out and Clockwise needs three maps per Light however many Looks there are. `ledmap.json` stays the base map (identity, or the well-house face map) and the Off preset and playlists name it. More than nine distinct maps on one Light is refused with a plain message, as the segment cap is today.

**Bands.** Sorting by height makes a Chase visit the lights of one ring one after another rather than at once. Two answers, cheapest first. Segment grouping (`grp`) set to the typical lights per ring makes the sorted map light a whole band per step with no new mechanism. A true band map, a 2D ledmap with one row per height band and `-1` for gaps, run with the segment's Expand 1D FX set to Bar, lights each band as one pixel. The band map is a later step and is gated on the bench test, as the earlier shape doc said.

**What stays.** `rev` and `mi` remain the direction controls. `directionForMotion` becomes the fallback for a controller with no map room, and its "split it" note goes away. The Shape panel keeps the same seven motions, so the person sees no new concept, only that Upward now works on a tree wired any which way.

## Capture: Scan it on an iPhone

The iPhone puts points in 3D space, in metres, where the person aims. It does not build a mesh of the tree and it does not find bulbs. The points describe the path, and Nightplot spreads the lights along it exactly as it does for a drawing today.

This needs a native app. Safari on iPhone does not support WebXR AR in 2026 ([threejsresources](https://threejsresources.com/webxr/browsers), [dev.to](https://dev.to/aplusgamesstudio/webxr-in-2026-vr-and-ar-in-the-browser-explained-7co)); only a Swift app can use ARKit and LiDAR. Dylan already has an Apple Developer membership, so the app can go out through TestFlight.

### Putting a point in space

| Where the point is | How it is placed |
| --- | --- |
| On a wall: window corners, door frames, roofline bends | Aim the crosshair and tap. ARKit finds the wall plane without LiDAR. Expected to be within a centimetre or two. |
| On a trunk or the surface of a bush | Aim and tap. With LiDAR the tap lands on the trunk. Without LiDAR, use the next row. |
| In the air: a branch tip, a fork, a jump between branches | Tap it once, step to one side, tap it again. The two sightlines cross at the point. Nothing has to be behind it. |
| Anything within reach | Hold the phone at the spot and tap. The point is where the phone is. |

Capture in daylight or at dusk. ARKit tracks by what the camera sees, and in full dark it drifts. The accuracy figures above are expected, not measured; slice 5's first test measures them.

### What the person taps, per shape

The app sends `measurements`, in the prop's unit, to `POST /api/props`. The server builds the drawing with the same code the browser uses, so no shape logic is written twice.

| Shape | Taps | Sent as |
| --- | --- | --- |
| Spiral | The first wrap and the last wrap, both sides of the trunk at the bottom, and both sides at the top (or the tip). Optionally two neighbouring wraps on the same side. | `{ shape: "spiral", height, around, aroundTop, gap }`. `around` is π × the width. `gap` is the measured spacing, or typed. |
| Split tree | The base, each fork and each tip, in the order the app asks. Once PR #192 lands, also both sides of the trunk and two neighbouring wraps, for its Around the trunk and Wrap every values. | `{ shape: "split-tree", trunks, levels, height, split, spacing, pose }`. `pose.nodes` are the tapped joints seen from the front: `x` across from the base, `y` up, ids in the existing scheme (`base`, `t0`, then `t0.1` and so on). `meets` and `turns` are sent empty, which `isSplitPose` accepts on main; PR #192 makes them optional and stops using them. Strings are assigned in the browser as today. |
| Window | The four corners. | `{ shape: "window", width, height }` |
| Straight roofline | Both ends. | `{ shape: "roofline", length }` |
| Anything else | Each bend in order, with Skip for a dark jump and New string for the next wire-in. | `layout` with `source: "trace"`: corners projected onto a front-on plane, metres, `y` up. |

"Seen from the front" means projected onto the vertical plane facing the person, the same view the browser draws. In the first version the depth is measured and then dropped, which matches what the templates already do.

The app also shows the planned path and light dots over the camera view before Save, so the person can see that the outline sits on the window or the coil sits on the trunk. After Save the prop opens in the browser editor like any other, and every edit there works as it does today.

**Placing the prop in the yard (optional in the same slice).** The yard frame is `x` along the front of the house and `depth` out from the wall. The person taps two points at the foot of the front wall to set that frame, then the prop's base. The app sends `x`, `depth` and `facing` to `PATCH /api/props/:id/yard`. ARKit's own origin is different in every session, so the wall taps are needed each time unless the app saves an ARKit world map.

### Talking to the server

The API has no login (`SECURITY.md`: a LAN utility), so the app calls the same routes as the browser: `GET /api/lights` to pick a Light, `POST /api/props`, `PATCH /api/props/:id/yard`, and `POST /api/lights/:id/blink` with `/blink/end` if a scan wants to light a bulb. The person types the server address once. iOS asks for local-network permission, and the app needs `NSAllowsLocalNetworking` because the server is plain HTTP on the LAN. Nothing changes on the server for the first version.

### Keeping the depth (later)

Once scans exist, the depth they measure can be kept instead of dropped. This builds on PR #192, which lands the first half:

- `LayoutCorner.z`, in metres toward the street, absent is 0 (#192). Scans write it on traced corners as well as template coils.
- `layoutLightPoints` returns `z`, and `placeYardLight` adds it toward the road (#192).
- `SplitPoseNode` gains an optional `z`, so a branch leaning toward or away from the street keeps its lean. #192 leaves this out on purpose.
- `drawnLengthM` measures in 3D when `z` is present, so a traced 3D path gets the right light count without `wrapLengthM`.
- `ShapeFields` gains `z` (0 to 1, back to front) and an angle around the prop's upright axis. Clockwise then goes around the trunk. A Front to back motion becomes possible. Version one uses `z` only to break ties.
- The browser keeps drawing front-on. `yardCamera` in `space.ts` exists but nothing in the web app uses it, and the editor is Konva (2D). A 3D view is not part of this spec.

## What must change, in order

Each slice is a PR that leaves the app working. Slices 1 and 2 are the payoff. The rest close the remaining gaps. Each row names the files the change lands in, checked against main.

| # | Slice | Change | Files |
| --- | --- | --- | --- |
| 0 | Bench test | On an ESP32 and an ESP8266 running WLED 0.15 and 16.x: a preset with `ledmap` switches maps cleanly, `ledmap` 0 with no file clears the map, maps of 300 to 1000 lights load, and `grp` on a sorted map bands as expected. Half a day. Gates slice 2's defaults, not its code. | none (hardware), notes into `docs/shape-aware-effects.md` |
| 1 | Motion map builder (built, software only, not Hardware Done) | New pure module that turns props, attachments, sections and motions into one map per Light per Look, deduplicated, with the virtual range of every section and a digest. Unit tests on a zigzag bush, a two-string split tree and a well house plus a tree on one Light. | new `packages/shared/src/prop/motion-map.ts`; reads `prop/shape.ts`, `prop/sections.ts`, `prop/wireframe.ts` |
| 2 | Push maps with Looks | Write `ledmapN.json` per distinct map, reread and compare each, then presets that set `ledmap` and use map positions for segments. Off preset and playlists set `ledmap` 0. Refuse over nine maps. Remove the "does not write for sections yet" note. | `apps/server/src/wled/native-backup.ts` (`WriteWledLedmap` gains a map number), `wireframe-persist.ts` (`writeAndVerifyLedmap` becomes write-all-maps), `look-routes.ts` (`pushLooksToLight`), `packages/shared/src/look.ts` (`buildLookPreset`, `buildOffPreset`, `buildPlaylistPreset`, `lookTargets`, `propSectionPlan`), `lights.ts` (`lastLedmap` becomes a list) |
| 3 | Attach every string (built, software only, not Hardware Done) | `PropAttachment` gains a string id; one attachment per string, each with its own output and start. Placement checks fit per string. Segments are written per string. The attach dialog asks per string. | `packages/shared/src/prop/types.ts`, `prop/design.ts` (`planPropPlacement`, `segmentsForProp`, `outputStartForAttachment`), `apps/server/src/prop-setup-routes.ts` (attach route), `apps/server/src/store/lights-store.ts`, the attach UI under `apps/web/src/components/props/` |
| 4 | Preview in map order | The yard preview samples each section in its motion order so the drawing matches the controller. `sampleLookStyle` takes an order, not just `dir`. | `packages/shared/src/look-design.ts`, `look-preview.ts` (`lookFrame`), `apps/web/src/components/looks/yard-canvas.tsx` |
| 5 | Scan it on iPhone | Starts with a throwaway ARKit test on one spiral and one split tree at dusk: tap the points, compare against a tape. Then the app: pick a server and a Light, pick a shape, tap its points, see the path over the camera, Save to `POST /api/props`. Spiral, split tree, window, roofline and free trace. Optional yard placement. No server or shared changes. | new `apps/ios/` (Swift, ARKit, Xcode project, not in the pnpm workspace); user docs in `docs/install.md` |
| 6 | Readback and season (built, software only, not Hardware Done) | Yard check compares every map digest per Light. The season file stores every map. Shape fixes already travel with the prop. | `packages/shared/src/yard.ts` (`compareLedmap`), `season.ts` (`ledmapJson` becomes a list), `apps/server/src/store/nightplot-restore.ts` |
| 7 | Band maps (optional) | 2D ledmap per band with Bar expansion, chosen per section as Whole rings at once. Only if `grp` banding from slice 2 is not enough. | `prop/motion-map.ts`, `look.ts` (segment `m12`), `sync.ts` already lists `m12` |
| 8 | Keep the depth (optional) | After PR #192. Scans keep `z` on traced corners, and split-tree joints gain `z`. Lengths in 3D when present. `z` and an around-the-axis angle in the shape fields, so Clockwise goes around the trunk. The iPhone app stops dropping depth. Only if Clockwise on wrapped trees matters after slices 1 to 5. | `prop/layout.ts` (`LayoutCorner`, `drawnLengthM`, `isPropLayout`), `prop/types.ts` (`SplitPoseNode`), `prop/split-tree.ts`, `prop/space.ts` (`layoutLightPoints`, `placeYardLight`), `prop/shape.ts` (`ShapeFields`), `apps/ios/` |
| 9 | Walk it in the editor (optional) | A lit-cursor capture mode in the one-page editor: light bulb N, tap its place, stride, Skip for a dark jump, New string. Produces placed lights on runs. Reuses the blink route and `LocateFrame`. Only for shapes no template or scan covers, such as a bush stuffed by hand. | `apps/web/src/components/yard-editor/` (new mode), `apps/web/src/components/props/add-prop.tsx` (`walkFrame`, to share), `apps/web/src/components/elements-editor/use-live-locate.ts`, `packages/shared/src/prop/layout.ts` (`addStringAt`), `apps/server/src/live/engine.ts` |

Refactors that fall out of the slices, not separate work:

- `directionForMotion` in `prop/shape-design.ts` loses its mixed-trend note and becomes the no-map fallback.
- `mergeFollowingSections` in `look.ts` merges by map position instead of physical adjacency.
- `compareLedmap` and `writeAndVerifyLedmap` stop special-casing the wireframe prop; the face map is one block in the base map.
- `PropLayout.faces` is still never written (noted in the shape doc). It is not needed for any slice here and can stay unused.

## Out of scope, and what needs your call

Out of scope, on purpose: a 3D mesh or model of the yard, a 3D view in the browser, finding bulbs by camera or photo, a Nightplot usermod on the board, live streaming of frames (shows must run with Nightplot closed), an Android app, and effects that need true 2D coordinates such as ripples across a bush. The motion map covers bottom to top, centre out and around, which is what the ask names.

Open questions, each with the answer the spec assumes:

- [ ] **Bench hardware.** Do you have an ESP32 and an ESP8266 to run slice 0 on, and which WLED versions are on the yard boards? Assumed: 0.15 on ESP32, so nine extra maps and 32 segments per Light.
- [ ] **Map room.** Is nine distinct motions per Light enough? Assumed yes; a typical library needs three or four.
- [ ] **Bands.** Is `grp` banding good enough for "the whole ring at once", or do you want slice 7 planned in from the start? Assumed: try `grp` first.
- [ ] **Order of slices.** Slices 1 and 2 first so Upward works on the existing split tree before capture changes. Say so if you would rather scan first.
- [ ] **iPhone.** Which model do you have, and does it have LiDAR (Pro)? Assumed: LiDAR is a bonus, not required; trunks without LiDAR use two-angle taps.
- [ ] **Where the app lives.** In this repo under `apps/ios/`, outside the pnpm workspace and not built by CI? Assumed yes.
- [ ] **Finding the server.** Type the address once, or have the server advertise itself over Bonjour? Assumed: typed address first.
- [ ] **Yard placement from the phone.** In slice 5, or left to dragging on the yard page? Assumed: in slice 5 if the wall taps prove reliable in the test, otherwise later.
- [ ] **Walk it.** Still wanted once scans exist? Assumed: optional, slice 9, every 10 bulbs by default with 5 and 20 on offer.

The thread "Map any light layout to spatial effects" builds from this spec once it is agreed.
