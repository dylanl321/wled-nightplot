# One yard page

This is a plan to approve before any code. Nothing here is built yet.

**Ask:** make, place, change, section and light props on one page instead of seven.
**Proposal:** one Konva yard drawing at `/` with a side panel that shows whatever is selected. Adding a prop, editing its path, naming sections, attaching it to a controller, and setting its colours in a Look all happen there. Hardware and show-level pages (Lights, LED products, Backups, Sync, Settings, the Looks playlist and schedule, Yard check) stay where they are.

Checked on main `7261b09` by reading every route and component on the prop path, and against Dylan's usability test of 2026-11-01 (epic #122). A software drawing is not a lit strip. Preview is temporary. Apply persists. Not Hardware Done.

## What a prop costs today

### The pages

| Job | Where it happens | Screens | Canvas |
| --- | --- | --- | --- |
| See the yard, place props | `/` (YardHome + YardStage) | 1 | Yard stage: every prop, yard frame, drag to move |
| New prop | `/props/new` (PropWizard) | Name → Shape → Size → (Origin) → (Draw) → Sections → Save, 4–6 screens | Path editor or section figure, prop frame, no neighbours |
| Edit the path | `/props/[id]/edit` (EditProp, draw phase) | Path editor → Name sections → Save | Path editor, prop frame |
| Sections | `/props/[id]/edit?step=sections` | 1, plus an Advanced drawer | Section figure, prop frame |
| Attach to a controller | `/props/[id]/attach` | 1, then See it | None |
| See it lit | `/props/[id]/see` | 1 | None |
| Colour sections in a Look | `/looks` (LooksPanel) | 1 long page; Save library sits under Playlist and Schedule | None |
| Yard check | `/yard` (YardPanel) | 1 | None |

Three different canvases draw the same prop: the yard stage, the path editor and the section figure. Each has its own camera, and only the yard stage shows the prop where it sits in the yard. Every editor screen is `immersive`, so the top bar disappears and the only way out is Back.

### Where one prop's properties live

| Property | Set in | Changed later in |
| --- | --- | --- |
| Name | Wizard step 1 | Nowhere (PR #132 adds Rename on the card) |
| Shape and template sizes | Wizard steps 2–3 | Nowhere; only by redrawing the path |
| Unit and spacing | Wizard size step | Path editor dock |
| Light count | Derived from spacing | Run list "Lights" field, or the Sections → Advanced stepper (which stretches the edge, #124) |
| Path | Wizard draw step | `/props/[id]/edit` |
| Sections and section colour | Wizard last step | `?step=sections` |
| Yard position | Defaulted on save | Drag on `/`; no numbers (#128) |
| Controller, output, start | — | `/props/[id]/attach` |
| Colour in a Look | — | `/looks` |
| Delete | — | Nowhere (PR #132 adds it to the card) |

That table is the confusion Dylan described. One prop's settings are spread over five routes, two of them only reachable during creation.

### Dylan's eight tasks, today

| # | Task | Path today | Outcome |
| --- | --- | --- | --- |
| 1 | Triangle X, 2 m × 2 m, 60 lights | `/` → New prop → Name → Shape → Size → Sections → Advanced → + ×10 → Save → reload | Done, wrong size (stepper stretched edges) |
| 2 | Make it an 80-light square | `/` → Edit → delete run, drag apex, Trace ×3 → Name sections → Save → reload | Done; old sections and "Mini tree" label kept |
| 3 | Rename to Box, put it 3 m right of origin | Searched 7 pages; dragged on `/` | Rename impossible, position unverifiable |
| 4 | Sections Top / Bottom | `/` → Sections → rename, toggle edges → Advanced to check → Save | Done |
| 5 | Look "Half and half" | Looks → Add Look → name → colours → scroll → Save library | Done |
| 6 | Turn off Bottom | Uncheck → scroll → Save library | Done |
| 7 | Line, 4 m, 120, then 100 | `/` → New prop → Name → Shape → Size (spacing 3.333 cm) → Origin → Draw → Lights field → Name sections → Save | Done; no count field |
| 8 | Delete Line | Searched 4 places | Impossible |

### Why it's confusing

1. **The job is split by mode, not by object.** You pick a page for what you want to do (create, edit, section, attach, look) and then find the prop again on it. Design tools that people already know (Figma, Keynote, xLights' layout tab) do it the other way round: select the object, and everything about it is beside it.
2. **The prop leaves the yard when you edit it.** The wizard and editor draw it alone in its own frame, so you can't see it against the house or the other props while you shape it, and "3 m right of the origin" has no meaning there.
3. **Creation-only settings.** Name, shape and template sizes are wizard steps with no way back once saved. That's why rename and "make it a square" were dead ends.
4. **Three save models.** The wizard saves at the end, Edit saves at the end and reloads `/` behind a 5–10 s Loading screen, and the yard drag saves at once. Looks saves the whole library from the bottom of the page.
5. **Names that point the wrong way.** The top-bar "Yard" is the controller health check. The place where the yard is drawn is the logo link.

## The design

### Layout

Desktop, 1440×900:

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ Nightplot   Yard  Looks  Lights  Check  ⋯              Look: [Off ▾]   Saved ✓  │
├────────┬──────────────────────────────────────────────────────┬──────────────────┤
│ + Add  │                                                      │ Box              │
│ ▭ Win  │      ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·          │ Window · 80 ⦁    │
│ ⌒ Arch │      ·  ┌──────┐  ·  ·  ·  ·  ·  ·  ·  ·  ·          │──────────────────│
│ △ Tri  │      ·  │ Box  │  ·  ·  ╱╲  ·  ·  ·  ·  ·          │ Name [Box     ]  │
│ ─ Line │      ·  └──────┘  ·  · ╱  ╲ ·  ·  ·  ·  ·          │ X [3.00] Y [1.00]│
│ ⋰ Draw │      ·  ·  ·  ·  ·  ·Tree · ·  ·  ·  ·  ·          │ Shape            │
│        │      ⊕──────────────────────────── 1 m ┤            │  W [2] H [2] m   │
│ Props  │                                                      │  Lights [80]     │
│ • Box  │                                                      │ Sections    ▸    │
│ • Tree │                                                      │ Controller  ▸    │
│ • Line │                                                      │ In this Look ▸   │
│        │                         [−] [+] [Fit]                │ [Edit path] [🗑] │
└────────┴──────────────────────────────────────────────────────┴──────────────────┘
```

- **Left rail (200 px):** the shape palette, then the prop list in a fixed order (by name, never reordered by an edit). Clicking a row selects that prop on the drawing.
- **Centre:** one Konva stage, the existing `EditorStage`. It shows the origin (⊕), a scale bar, and the grid. The wheel scrolls the page unless the drawing has focus or Ctrl/⌘ is held, which is #128's rule.
- **Right panel (360 px):** the inspector. Its contents follow the selection (below).
- **Top bar:** the nav, a Look picker (see "Look lens"), and one save indicator for everything on the page.

Phone, 390×844: the drawing fills the screen, the palette is a + button, the prop list is a sheet, and the inspector is a bottom sheet with three heights (peek: name and count; half: the fields; full: sections or controller). All Off and the bottom nav stay visible, because the page isn't immersive any more.

### The inspector follows the selection

| Selected | Panel shows |
| --- | --- |
| Nothing | Yard summary: the setup checklist in one line each, prop count and total lights, yard unit (ft/m) and default spacing, Yard check status with a link |
| A prop | Name, X/Y, rotation later, shape and its template sizes, light count and spacing, then four folds: Sections, Controller, In this Look, Danger (Delete). Buttons: Edit path, Duplicate, Delete |
| A run (in path mode) | Length, lights (with "set by hand" and a Reset when overridden), lit or dark, string, Delete run |
| A section | Name, colour (picker and hex field), its runs, light numbers 1-based with the 0-based WLED index shown beside, Delete section |
| Several props | Count, align and spread, Delete |

Every field writes at once (debounced) and is read back, using the PATCH routes that exist plus the rename and delete routes from #123. One yard-wide Undo covers all of it. The save indicator says "Saving…", "Saved", or "Not saved: reason" and keeps the change on screen so it can be retried. There is no Save button and no Loading screen.

### Canvas modes

There are three, and the current one is always shown at the top left of the drawing. Esc goes back to Select.

1. **Select (default).** Click a prop to select it, drag to move it (snap to the grid, position shown while dragging), drag empty space to pan, Shift-click to add to the selection. Delete removes the selection after one confirm that says nothing is sent to a controller.
2. **Add.** Pick a shape in the palette. A ghost of it follows the pointer at its default size. Click to drop it; its name field is focused with "Window 2" ready to type over. Line and Draw it instead start tracing at the click. Template sizes, unit, spacing and an optional light count are fields in the inspector right away. There is no wizard.
3. **Path.** Double-click a prop, or press Edit path. The other props fade to 25 %, and the path editor's tools (Trace, Move corners, Mark dark, Add string, Split, Join, Snap) appear as a floating toolbar on the drawing instead of a separate page. The prop stays at its yard position, so its neighbours are visible. Done or Esc returns to Select.

Sections use Select, not a mode of their own. Open the Sections fold, pick or add a section, and then clicking runs on the drawing toggles them in or out of that section. The colours show on the yard right away.

### Shape stays editable

A prop made from a template keeps its template sizes in the inspector for as long as its path still matches the template. Changing W or H regenerates the path, and the sections follow by edge role, which uses #126's reconcile logic. Once the path is edited by hand, the shape reads "Drawn" with a **Reset to Window** action. "Make it a square" becomes: pick Window, or type W = H.

A light-count field sits next to spacing. Typing 120 on a 4 m Line sets spacing to 3.33 cm. On a multi-edge shape it spreads the count by length. That shares #129's helper.

### Controller fold

This takes the content of `/props/[id]/attach` and `/see`: controller, output, where on the output (start, or after another prop), the list of what gets written, Blink, then Apply with backup and readback. After Apply, the fold shows the readback result and a **Check on the lights** button. Without controllers, it shows the same "Connect controllers" line with a link to Find Lights. The honesty rules don't change: Apply is the only thing that writes to a controller, and a mismatch is not success.

### Look lens

The Look picker in the top bar defaults to **Off**, which is the plain design view. Picking a Look recolours the drawing with that Look. Props and sections not in the Look are drawn dim. With a Look picked:

- Clicking a section, or a prop without sections, toggles it in or out of the Look.
- The inspector's "In this Look" fold shows the colour (with hex) and effect for the selected prop or section.
- Changes save like any other field.

The Looks page keeps what is about the whole show: the library list (add, rename, reorder, delete), the playlist, the nightly schedule, and Push to Lights. Each Look in the list gets an **Edit on yard** link that opens `/` with that Look picked. This depends on #127, where a Look stores the props it includes, so a new prop doesn't light up in old Looks.

### Keys

V select, N add, P or Enter path mode, Esc back to Select, Delete, ⌘/Ctrl+Z and Shift for redo, F fit, arrows nudge by one grid step (Shift for 10), ⌘/Ctrl+D duplicate. The shortcut overlay lists them.

### Routes and nav

- `/` is the yard editor. Deep links: `/?prop=<id>`, `/?prop=<id>&mode=path`, `/?prop=<id>&fold=sections|controller`, `/?look=<id>`.
- The old routes redirect there: `/props/new` → `/?mode=add`, `/props/[id]/edit` → `/?prop=<id>&mode=path`, `?step=sections` → `fold=sections`, `/attach` and `/see` → `fold=controller`. Bookmarks and the Playwright suites keep working.
- Nav: **Yard** (this page), **Looks**, **Lights**, **Check** (today's `/yard`, renamed, same page), and **More** for LED products, Backups, Sync and Settings. The phone bar matches.

### Data

No migration. Props already store a prop-frame `layout` plus a `yard` point. Path mode draws the layout offset by the yard point and saves back in the prop frame. Template sizes are already in `design.measurements`. The one new field is a yard-level default unit and spacing in settings, which also covers #125's "start in the last unit".

### What is left out on purpose

- Rotation and a house photo or plan backdrop are later slices, and they fit this layout.
- The Light Segments editor (Locate, Cut, Pick LEDs) stays behind a Light's Advanced link. It's about one controller's strip, not the yard.
- The playlist, schedule and push stay on Looks.

## Dylan's eight tasks in this design

| # | Task | Clicks in the new design |
| --- | --- | --- |
| 1 | Triangle X, 2 × 2 m, 60 | Palette Triangle → click the yard → type "X" → Unit m, W 2, H 2 → Lights 60 |
| 2 | 80-light square | Shape: Window (or W = H) → Lights 80 |
| 3 | Rename Box, 3 m right of origin | Name "Box" → X 3, Y 0 |
| 4 | Top 1–40, Bottom 41–80 | Sections fold → Add "Top" → click two runs → Add "Bottom" → click two runs |
| 5 | Look "Half and half" | Looks → Add Look "Half and half" → Edit on yard → click Top → #FF0000 → click Bottom → #00FF00 |
| 6 | Bottom off | Click Bottom on the drawing (toggles it out) |
| 7 | Line 4 m, 120, then 100 | Palette Line → drag 4 m (or type Length 4) → Lights 120 → select the run → Lights 100 |
| 8 | Delete Line, reload | Select Line → Delete → confirm |

There are no page changes after step 5, no Save buttons, and no reloads.

## Fitting with epic #122

The "Fix editor usability test findings" work keeps going. Most of it is logic this plan reuses, so none of it is wasted.

| Issue | What this plan does with it |
| --- | --- |
| #123 Rename and delete (PR #132) | Reuses the server routes. The card buttons later become inspector fields and the Delete key. |
| #124 Stepper keeps edge length | Reuses `lockedLights`. The Advanced stepper becomes the run inspector's Lights field. |
| #125 Feet/metres conversion | Reuses the conversion. "Last unit" becomes the yard-level unit. |
| #126 Sections after a path edit | Reuses the reconcile, which is needed for editable template sizes. "Drawn" label kept. |
| #127 Looks store included props | Needed for the Look lens. Lands first. |
| #128 Origin, axes, coordinates, wheel | Built into `EditorStage` / `YardStage`, which become the editor's canvas. The X/Y readout moves into the inspector in slice 2. |
| #129 Triangle and light count | Reuses the shared template and count helper. The wizard field is short-lived. |
| #130 Smaller friction | The hex field and 1-based numbering are reused. Moving "Save library" and the post-save Loading screen are both superseded by autosave, so skip them there. |

The other thread has been asked to keep logic in `packages/shared` and the server, and to keep its UI edits to the wizard, Edit and the card small.

## Slices

One PR each, in order. The old routes keep working until slice 8, so main is shippable after every slice.

1. **Yard page shell.** Three columns on desktop and sheets on the phone, using the existing `YardStage`. Selection model, a fixed-order prop list, the nothing-selected panel, the page-wide save indicator and Undo. The page is no longer immersive.
2. **Prop inspector.** Name, X/Y, unit, spacing, light count, Duplicate, Delete (with key). Shape shown read-only.
3. **Path mode in place.** `PropLayoutEditor`'s tools move into a canvas mode in the yard frame, with neighbours faded and a run inspector. Edit on the card opens this.
4. **Add on the drawing.** Palette, ghost, click to drop, Line and Draw it trace at the click. Template sizes are editable in the inspector, with Reset to template. New prop opens this.
5. **Sections fold.** Section list in the inspector, click runs on the drawing, colour with hex, 1-based numbers.
6. **Controller fold.** Attach, Blink, Apply with readback, and Check on the lights, all in the panel.
7. **Look lens.** Top-bar picker, click to include or exclude, colour and effect fold. Looks page gets Edit on yard; the library list, playlist, schedule and push stay there.
8. **Routes, nav and cleanup.** Redirects, the Yard / Looks / Lights / Check / More nav, delete the dead pages, and a Playwright run of the eight tasks above at 1440×900 and 390×844.

Every slice: lint, typecheck, unit tests, phone overflow, and the editor Playwright suite pass.
