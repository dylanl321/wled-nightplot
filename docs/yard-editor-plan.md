# One yard page

This is a plan to approve before any code. Nothing here is built yet.

**Ask:** make, place, change, section and light props on one page instead of seven.
**Proposal:** the yard drawing at `/` is home, and it shows everything. Focused jobs open a scoped view in the same page, one level deep, and always come back. Building or editing a prop happens on its own clean canvas with Save and Cancel. A Look is the yard drawn in that Look's colours. Placing, renaming, attaching and deleting happen on the yard itself. Hardware and show-level pages (Lights, LED products, Backups, Sync, Settings, the Looks playlist and schedule, Yard check) stay where they are.

A clickable prototype is in [`docs/prototypes/yard-page.html`](prototypes/yard-page.html) (open it in a browser). It has the eight test tasks built in.

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
2. **Every edit is a trip through full-screen routes.** The wizard, Edit and Sections are separate pages with their own Back buttons, nested two or three deep (Edit → Name sections → Save → reload). It's never clear where you are, how to get back, or whether leaving saved anything.
3. **Creation-only settings.** Name, shape and template sizes are wizard steps with no way back once saved. That's why rename and "make it a square" were dead ends.
4. **Three save models.** The wizard saves at the end, Edit saves at the end and reloads `/` behind a 5–10 s Loading screen, and the yard drag saves at once. Looks saves the whole library from the bottom of the page.
5. **Names that point the wrong way.** The top-bar "Yard" is the controller health check. The place where the yard is drawn is the logo link.

## The design

### The rule: one home, scoped views one level deep

Dylan, 2026-11-01: "We see everything and then have custom views for things like double clicking a prop to edit it in a scoped canvas. Adding a new prop brings up a clean canvas for me to build and then save and goes back to the yard for me to place." That applies everywhere, not only to props.

- **The yard is home.** It shows every prop where it stands. You select, move, rename, place, attach and delete here. Changes autosave, with one yard-wide Undo.
- **A focused job opens a scoped view** in the same page. The URL changes so Back works, but nothing loads. The view shows only what that job needs and says where you are ("Yard › Box"). It always returns to the yard. A scoped view never opens another scoped view, so there is no nesting.
- **Two kinds of scoped view:**
  - **Draft views** (build or edit a prop) work on a copy. They have **Save** and **Cancel**, an "Not saved yet" marker, and their own Undo. Cancel with changes asks once. Saving a new prop returns to the yard with the prop as an outline, ready to place: click a spot with a mouse, or drag the outline on a phone and press **Place here**.
  - **Lens views** (a Look) are the yard drawn a different way. Edits autosave like the yard, and **Done** returns.
- Esc always means "back one level": first it clears the selection, then it leaves the view.

### Views

| View | Opens from | Shows | Leaves by |
| --- | --- | --- | --- |
| **Yard** (home, `/`) | The nav and the logo | Every prop, the origin, a scale bar and the grid. Left rail: New prop, the props (sorted by name), the Looks. Right panel: the selection. | — |
| **Prop canvas** (`/?prop=<id>&view=edit`, or `view=new`) | New prop, double-click a prop, Enter, "Edit shape" | Only that prop, in its own frame, with the wire-in at 0,0. Its runs carry length and light labels, and corners are handles. A floating toolbar has Select/move, Trace and Add point (plus Mark dark, Add string, Join and Snap from today's editor). Panel, in the order you need it: shape, size (with the unit beside it), light count and spacing, name, sections, runs. The selected run or section opens at the top. | Save (new: Save and place), Cancel, Esc |
| **Look** (`/?look=<id>`) | A Look in the yard rail, + New Look, or Edit on yard from the Looks page | The yard in that Look's colours, with everything not in the Look dimmed. Clicking selects a prop (and then a section of it). The panel does the switching: Switch on/off, Colour for Whole prop or a section, hex, effect, and "lights up" per section. | Done, Esc |

The **Controller** setting stays a fold in the yard panel, because it's a short form about where a prop is wired, not a drawing job. It has controller, output, start or after another prop, what gets written, Blink, and Apply with readback.

### Yard layout

Desktop, 1440×900:

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ Nightplot   Yard  Looks  Lights  Check  More                     ↶ ↷   Saved ✓ │
├────────────┬──────────────────────────────────────────────────┬──────────────────┤
│[+ New prop]│      ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·          │ Box              │
│            │      ·  ┌──────┐  ·  ·  ·  ·  ·  ·  ·  ·          │ Window · 80      │
│ PROPS      │      ·  │ Box  │  ·  ·  ╱╲  ·  ·  ·  ·  ·         │ Name [Box     ]  │
│ • Box   80 │      ·  └──────┘  ·  · ╱  ╲ ·  ·  ·  ·  ·         │ X [3.00] Y [0.00]│
│ • Tree  32 │      ·  ·  ·  ·  ·  · Tree  ·  ·  ·  ·  ·         │ Sections         │
│ • Line 100 │      ⊕─────────────────────────── 1 m ┤          │  ● Top     1–40  │
│            │                                                  │  ● Bottom 41–80  │
│ LOOKS      │                                                  │ [Edit shape and  │
│ • Warm 5/5 │                                                  │  sections] [⧉][🗑]│
│ [+ New]    │                         [−] [+] [Fit]            │ Controller    ▸  │
└────────────┴──────────────────────────────────────────────────┴──────────────────┘
```

Prop canvas, same window:

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ Nightplot  Yard › Box                       Not saved yet  ↶ ↷  [Cancel] [Save] │
├──────────────────────────────────────────────────────────────┬───────────────────┤
│ Editing Box      [Select/move | Trace | Add point | Fit]     │ Name [Box      ]  │
│                                                              │ SHAPE             │
│      ■━━━━━━━━━━━ 2.00 m · 20 ━━━━━━━━━━━■                   │ [Line][Window][△] │
│      ┃                                   ┃                   │ [Λ] [Arch] [Draw] │
│  2.00 m · 20                         2.00 m · 20             │ W [2]  H [2]  m   │
│      ┃                                   ┃                   │ LIGHTS            │
│      ■━━━━━━━━━━━ 2.00 m · 20 ━━━━━━━━━━━■                   │ How many [80]     │
│      Wire in · light 1                                       │ RUNS / SECTIONS   │
└──────────────────────────────────────────────────────────────┴───────────────────┘
```

On a phone (390×844), every view uses the same layout: the drawing fills the screen, the right panel becomes a bottom sheet with three heights, and the yard rail is a sheet behind "☰ Props". In a scoped view the top bar shows only the prop name, Cancel and Save.

### Inside the prop canvas

- **A new prop starts on a clean canvas.** The panel shows "Start from" tiles: Line, Window, Triangle, Mini tree, Arch, Draw it. Picking one draws it at default size. Draw it waits for a click at the wire-in and then traces.
- **The shape stays editable.** Template sizes stay as fields for as long as the path matches the template. Picking another tile replaces the shape, and the panel says it clears sections. Once a corner is dragged or a run traced, the shape reads "Drawn", with **Reset to Window** (or whichever template it came from). "Make it a square" means pick Window, or type W = H. Sections follow by edge role when sizes change (#126).
- **Lights.** "How many lights" sits next to spacing. Typing 120 on 4 m sets spacing to 3.33 cm, and on several runs it spreads the count by length (#129). Clicking a run shows its length and "Lights on this run". A typed count is marked * and has a "Count from length" reset.
- **Sections.** New section, then click runs on the canvas to put them in or take them out. Each section shows its colour with a hex field, and its lights 1-based with the WLED 0-based range beside it. Runs in no section are listed.
- Keys: V select, T trace, A add point, Delete removes the selected run, ⌘/Ctrl+S saves, Esc leaves (asks if there are changes).

### Inside the yard

- Click selects, drag moves (snap, with a live X/Y readout), the arrow keys nudge, Delete asks once and is undoable, ⌘/Ctrl+D duplicates, Enter or a double-click opens the prop canvas, N is New prop, F fits.
- The panel with nothing selected shows the setup checklist, counts, the yard unit and default spacing, and the keys.
- The wheel pans and Ctrl/⌘ + wheel zooms (#128). The drawing is the whole screen, so there is no page to scroll.

### Look view

The Looks page keeps what is about the whole show: the library list, playlist, schedule and Push to Lights. Each Look there gets **Edit on yard**, which opens the Look view. In the Look view, a click only selects: first the prop, then one of its sections. Switching on and off, colours and effects are buttons in the panel, so nothing changes by a stray tap. This depends on #127, where a Look stores the props it includes, so a new prop starts off in old Looks.

### Routes and nav

- `/` is the yard. `/?prop=<id>` selects. `/?prop=<id>&view=edit`, `/?view=new` and `/?look=<id>` open the scoped views. Browser Back leaves a scoped view, with the same "discard changes?" check as Cancel.
- Redirects: `/props/new` → `/?view=new`, `/props/[id]/edit` and `?step=sections` → `/?prop=<id>&view=edit`, `/attach` and `/see` → `/?prop=<id>` with the Controller fold open.
- Nav: **Yard**, **Looks**, **Lights**, **Check** (today's `/yard`, renamed), and **More** for LED products, Backups, Sync and Settings. The phone bar matches.

### Data

No migration. The prop canvas edits the prop-frame `layout`, and the yard edits the `yard` point, which is how they're stored today. Template sizes are already in `design.measurements`. The one new field is a yard-level default unit and spacing, which covers #125's "start in the last unit".

### What is left out on purpose

- Rotation and a house photo or plan backdrop are later, and they fit this layout.
- The Light Segments editor stays behind a Light's Advanced link.
- The playlist, schedule and push stay on Looks.

## Dylan's eight tasks in this design

| # | Task | Route |
| --- | --- | --- |
| 1 | Triangle X, 2 × 2 m, 60 | New prop → Triangle (starts at 2 × 2 m) → How many 60 → Name X → Save → place it |
| 2 | 80-light square | Double-click X → Change shape → Window → W 2, H 2 → How many 80 → Save |
| 3 | Rename Box, 3 m right of origin | Select X → Name Box → X 3, Y 0 |
| 4 | Top 1–40, Bottom 41–80 | Double-click Box → New section "Top" → click two runs → New section "Bottom" → click two runs → Save |
| 5 | Look "Half and half" | + New Look → name it → select Box → Switch on → Top #FF0000 → Bottom #00FF00 → Done |
| 6 | Bottom off | Open the Look → select Box → Bottom → untick "lights up" → Done |
| 7 | Line 4 m, 120, then 100 | New prop → Line → Length 4 → How many 120 → Save → place → Edit shape → How many 100 → Save |
| 8 | Delete Line, reload | Select Line → Delete → confirm |

Every task starts and ends on the yard, and none goes more than one view deep.

## First-use walkthrough of the prototype

On 2026-11-01 the prototype was walked as a first-time user, on a 390×844 phone and at 1440×900, doing all eight tasks from opening the page. Each screen was checked for what a new user would trip on. What was found, and the rule it became:

| Found | Rule for the build |
| --- | --- |
| The size fields sat below the fold, under Name, after picking a shape. | The panel follows the task: shape, size, lights, then name. Sizes show without scrolling on a phone. |
| Typing into a filled number field added to it (64 became 6480). A field re-rendered while it was being tapped, so the next field lost its input. | A number, hex or auto name is selected on first tap, so typing replaces it. A change never rebuilds the field you just tapped. |
| A hex box at full length took no typing. | Same rule: select on tap. |
| Tapping to place dropped the prop in the sky, and a fingertip can't aim on a small yard. | The outline starts on the ground in view. Touch drags the outline; **Place here** confirms. Mouse click still places. |
| In a Look, a second tap on a prop silently switched it. There was no way to open the prop list. | Taps select, the panel switches. The props list is reachable in every yard view. |
| The sheet handle did nothing when the panel was short. The drawing didn't refit when the sheet grew. | Sheet heights are fixed steps, and the drawing refits to the part left visible. |
| Changing X and Y moved the prop behind the sheet. | Editing a position keeps the prop in view. |
| Labels jumped far from their props. Axis numbers had no unit, and negative heights were drawn below ground. | A label goes above, else below, else hides until selected. Axes carry units. Below ground is shaded, unlabelled, and fitting puts the ground near the bottom. |
| The scale bar sat behind the buttons. A redundant "Yard" chip, desktop-only copy ("double-click") and a keys list showed on a phone. | Phone chrome is one row; copy says tap on touch; keys show only with a keyboard. |
| New prop was a small floating button. Save worked with no shape. | New prop is the first thing in the yard panel on a phone. Save is disabled until there is a shape. |
| A prop kept its old template name ("Triangle 1" became a window). | An automatic name follows the shape; a typed name is kept. |
| A panel kept its scroll position after deleting a prop. | A panel opens at the top when what it shows changes. |

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

Epic #133. One PR each, in order. The old routes keep working until slice 8, so main is shippable after every slice. (Slices 3–5 and 7 were reshaped on 2026-11-01 for scoped views; see each issue.)

1. **Yard page shell** (#134). Three columns on desktop and sheets on the phone, using the existing `YardStage`. Selection model, a fixed-order prop list, the nothing-selected panel, the page-wide save indicator and Undo. The page is no longer immersive.
2. **Yard prop panel** (#135). Name, X/Y with a live drag readout, a sections summary, Duplicate, Delete (with key), and the yard unit and default spacing.
3. **Prop canvas view** (#136). A scoped view for one prop: `PropLayoutEditor`'s drawing and tools in its own frame, a run panel, Save/Cancel with draft Undo, and a discard check. Edit and double-click open it.
4. **New prop and placing** (#137). New prop opens the prop canvas clean, with Start from tiles and editable template sizes plus Reset. Save and place puts the prop on the pointer in the yard.
5. **Sections in the prop canvas** (#138). Section list, click runs to assign, colour with hex, 1-based numbers.
6. **Controller fold** (#139). Attach, Blink, Apply with readback, and Check on the lights, all in the panel.
7. **Look view** (#140). The yard in a Look's colours, click to include or exclude, colour and effect panel, Done. The Looks page gets Edit on yard.
8. **Routes, nav and cleanup** (#141). Redirects, the Yard / Looks / Lights / Check / More nav, delete the dead pages, and a Playwright run of the eight tasks above at 1440×900 and 390×844.

Every slice: lint, typecheck, unit tests, phone overflow, and the editor Playwright suite pass.
