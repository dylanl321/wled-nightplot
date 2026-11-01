# Looks on the yard: plan

**Ask (Dylan, 2026-11-01):** "think through how we are to design, view, manage, and apply the actual WLED scenes, colours, and things to the props."

**Proposal:** keep the rule from the one-page yard plan ([`yard-editor-plan.md`](yard-editor-plan.md), PR #142). The yard is home, and a focused job opens one scoped view that always comes back. Designing a Look happens in the **Look view**: the yard drawn in that Look's colours and effects, with a panel that sets each prop to **Follow**, **Own style** or **Off**. Managing happens on the **Looks page**, which has four tabs (Looks, Playlists, Schedule and By prop) under a "Now on the lights" bar. Applying is two separate, honest steps. **Preview on lights** is temporary and puts things back when it ends. **Send** writes presets to every Light, reads them back and can be undone. A global pill says what isn't on the lights yet.

The clickable prototype is [`docs/prototypes/looks.html`](prototypes/looks.html). Open it in a browser. It has nine test tasks built in, and a switch that unplugs Garage Light. Nothing in it is saved or sent.

The word stays **Look**, because AGENTS.md bans "scenes". This plan adds no new product nouns. Playlist and Schedule are already in the UI.

A drawing in the browser is not a lit strip. Preview is temporary, and Apply (Send) persists. None of this is Hardware Done.

## What exists today

| Piece | Where | State |
| --- | --- | --- |
| Look data | `packages/shared/src/look.ts` | `Look { slot, style, overrides[], propIds? }`. A style is `fx, pal, sx, ix, bri, color, color2`. Overrides can target a section, a prop, a prop kind, a Segment or a wireframe group, and any of them can be `off`. |
| Look view | PR #142, `yard-editor.tsx` `lookPropPanel` / `lookSummary` | The yard in a Look's colours. It switches a prop on or off, and sets a colour and effect for the whole prop or a section. It autosaves. |
| Looks page | `/looks`, `looks-panel.tsx` | One long page: an accordion library, one playlist, "Push to Lights", and one nightly Schedule. |
| Effects offered | `LOOK_EFFECTS`, `LOOK_PALETTES` | 7 effects and 5 palettes, hard-coded. Speed, intensity and colour 2 can't be set in the Look view. |
| Preview | `/api/lights/:id/preview` | Static colour spans on one Light. No effects and no whole-yard Preview. |
| Turn a preset on | Sync page, "Turn on a preset" | You pick Lights and a preset number. Look names aren't shown. |
| Schedule | `schedule.ts` | One row: sunset or a clock time on, a clock-time off, every day or chosen weekdays. |

What a user can't do today: watch an effect before sending it, see whether the lights have their latest Looks, run different Looks in different seasons, give one Look in a playlist more time than another, find which Looks a prop is in, or add a new prop to existing Looks without opening each one.

**Bug found along the way:** WLED 0.15.1 checks timer slot 8 for sunrise and slot 9 for sunset (`wled00/ntp.cpp` `checkTimers`). Nightplot writes its sunset "on" to slot 8, so the nightly Schedule probably fires at sunrise. This is fixed separately in the "Fix sunset schedule firing at sunrise" thread. Slice 7 depends on that fix.

## The model in plain words

- **A Look is what the whole yard shows at one moment.** It's one WLED preset with the same number on every Light.
- **Every prop is Follow, Own style or Off in each Look.** Follow uses the **Look style**, which is the Look's own effect and colours. Own style gives that prop its own. Off keeps it dark. A new prop starts Off in every existing Look (#127), and the yard offers "Add to Looks…".
- **Sections work the same way, one level down.** Each section is Follow prop, Own style or Off. While every section follows, the prop is sent as one WLED segment, so a chase runs along the whole prop. Once a section has its own style, each section becomes its own segment and runs its own effect. The panel says which of the two is happening.
- **A style** is an effect, up to three colours, a palette, the effect's two sliders, brightness, and direction (from light 1, from the end, or mirrored). The effect's own metadata decides which colours and sliders are shown and what they're called, for example "Stripe" and "Gap" for Theater chase.

That replaces today's five override targets in the UI with one rule people can predict. Prop-kind rules become a selection shortcut ("Select all windows") that sets each prop, so you can always see why a prop looks the way it does. Existing propKind, Segment and wireframe overrides keep working and are still sent. Their props show "Own", and editing one turns it into a per-prop setting.

## Where things live

| View | Opens from | Job | Leaves by |
| --- | --- | --- | --- |
| **Yard** (home, `/`) | Nav | Select a prop. Its panel gets a **Looks** fold that lists every Look with a strip of what the prop shows in it, plus **Add to Looks…**. A new prop shows a "Wreath is new" banner. | — |
| **Look view** (`/?look=<id>`, scoped) | A Look card, the Look list in the yard rail, a By-prop cell, or the yard's Looks fold | Design one Look on the yard. It animates. A switcher in the top bar changes Look. **Preview on lights** toggle. **Done**. | Done, Esc |
| **Looks page** (`/looks`) | Nav | "Now on the lights" bar, then tabs: **Looks** (cards with live thumbnails, Not sent / Changed / On now tags, Edit, Turn on now, Duplicate, + New Look), **Playlists**, **Schedule** and **By prop** (props × Looks table). | — |
| **Send** (dialog) | The top-bar pill, or the toast after Done | What changes, which Lights, Send, per-Light results, Undo. | Close |

Nothing nests. The Look view is the only scoped view this plan adds, and #142 already has its shell. The effect and palette pickers replace the panel's content with a "‹ Back" button. They aren't views.

### The Look view panel

- **Nothing selected:** name, a **Props** list with a Follow / Own / Off switch on each row (this is how you get to props on a phone without aiming at the drawing), **Select all windows / bushes**, **Switch every prop on**, then the **Look style** editor with Look brightness. **More** holds the WLED preset number, Duplicate, **Start from what a Light shows…** (it reads a Light's live segments, so a look built in the WLED app can be brought in), and Delete. A warning shows when a Look needs more segments on a Light than `info.leds.maxseg` allows.
- **One prop:** Follow Look / Own style / Off. Section chips with dots, plus the whole-prop/per-section note. Then the style editor, or a preview strip of what Follow gives it.
- **A section** (tap the prop again on the drawing, or a chip): Follow prop / Own style / Off, and its lights shown 1-based.
- **Several props** (Shift-click, or a Select-all button): one mode switch for all of them. A dashed box and a note say when their styles differ. A change sets just that one setting on all of them.
- **Style editor:** an effect row with a live strip opens the **effect picker** (search, grouped as Still, Glow & fade, Chase, Twinkle & sparkle, Colour cycle, Fire & weather, each with an animated strip in your colours). Then the colour rows the effect uses, each with a hex field, recent swatches, and a palette row with gradient swatches when the effect uses one. Then the effect's sliders, named the way WLED names them, and brightness. **Direction and more** holds direction plus Copy style / Paste style.

## Applying: Preview, Send, Turn on

These are three different things, and the UI never blurs them.

| Action | What it writes | Lasts | Where |
| --- | --- | --- | --- |
| **Preview on lights** | Live state (`seg` with fx, colours, palette, sliders) on every Light the Look uses, through the live engine, after a restore snapshot | Until you switch it off, press Done or leave. Then each Light goes back to what it showed. | Look view top bar. The chip says "Previewing on 2 of 3 Lights · Garage Light didn't answer". |
| **Send** | `presets.json` slots for changed Looks, playlists and the Off slot, plus `cfg.timers` and NTP for the Schedule. A background backup goes first, then a readback. | Persists. Doesn't change what's showing now. | Top-bar pill "3 changes not on the lights · Send", or the toast after Done |
| **Turn on now** | `ps` = that preset or playlist on every Light, with readback (today's `/api/sync/preset`) | Until the Schedule's next step | Look and playlist cards. "Send and turn on" when the Look has unsent changes. |

- **Not sent** is tracked per Light. A Light that didn't answer shows "Garage Light: 4 not sent" in the "Now on the lights" bar until a later Send reaches it. Fail closed per controller: one dead box doesn't stop the rest.
- Edits save in Nightplot as you make them (autosave, as in #142). Saving and sending are separate on purpose: an unfinished Look never reaches the lights, and you can design in daytime and send once.
- **Now on the lights** reads each Light's active preset or playlist (`state.ps`, `state.pl`) and names it ("Warm white · from Nightly playlist"). It says what the Schedule does next, and notes when something was turned on by hand.

## Playlists

Each playlist is a card with a coloured bar showing each Look's share of time. Edit opens it in place:

- an ordered list of Looks with **minutes for each one**. WLED's `dur` takes one value per entry, and today Nightplot sends one value for all of them.
- ↑ to reorder, ✕ to remove, + Add a Look
- **Fade between Looks** in seconds (`transition`)
- **After the last Look:** Start again (`repeat: 0`) or Turn off (`repeat: 1`, `end: 250`)
- **Turn on now**. A playlist the Schedule uses can't be deleted until the Schedule stops using it.

## Schedule

The single nightly Schedule becomes a list of rows, shown on a **year bar**. Each row has: what runs (a Look or a playlist), dates (all year, or from–to, which can cross New Year), days of the week, turn on (at sunset ± minutes, or a time), and turn off (a time, sunrise, or leave on). When two rows cover the same day, the higher row wins, and ↑ moves a row.

What WLED can do decides the design (`wled00/cfg.cpp`, `ntp.cpp`, 0.15.1):

- 8 clock timers (slots 0–7). Each has a time, weekdays and a **date range**, and a range may wrap the year.
- One **sunrise** timer (slot 8) and one **sunset** timer (slot 9). They take weekdays and an offset, but **no date range**.

So:

1. The all-year row that starts at sunset gets WLED's sunset timer.
2. A **dated** row that starts at sunset follows sunset with clock timers, one for each stretch of dates where sunset moves less than 10 minutes. Each one fires a minute after the latest sunset in its stretch. For Nov 25–Jan 6 at about 40°N that's 2 timers. The row lists the times ("5:19 PM from Nov 25, 5:22 PM from Jan 3; starts at most 12 minutes after sunset") and says that the all-year row starts at sunset on those days first, then this row takes over. "Use one clock time instead" is one tap away.
3. Off times are shared: rows with the same off time and days use one timer.
4. A **timer meter** shows "4 of 8 clock timers · sunset timer: Nightly · sunrise timer: free". Over 8 is an error that blocks Send and says how to fix it.
5. Sunset comes from the location in Settings. Each Light works out its own sunset from the same latitude and longitude, so Nightplot can be closed.

## Effects and palettes come from the Lights

The prototype's 17 effects and 19 palettes stand in for the real lists. The build reads them from each Light (`/json/eff`, `/json/fxdata`, `/json/pal`, `/json/palx`) and caches them by firmware version. `fxdata` gives each effect's slider and colour labels, whether it uses a palette, and its flags, and the picker hides effects flagged 2D (`2`) or audio (`v`, `f`). An effect missing on one Light in the Look is marked in the picker, and Send refuses it for that Light, with the reason.

The in-browser animation is an approximation, written once in `packages/shared` and covering the common effects. Any other effect shows its colours drifting slowly, labelled "drawing approximate". Preview on lights is the real check.

## Data (backward compatible)

| Change | Notes |
| --- | --- |
| Follow / Own / Off | **No new fields.** Follow = in `propIds` with no prop override. Own = a `propId` override. Off = not in `propIds`. A section's Own or Off = a `sectionId` override (`off: true`). |
| `LookStyle.color3?`, `dir?` (`seg.rev`, `seg.mi`), `opacity?` (segment `bri`) | Optional. Absent means today's behaviour. |
| `Look.transitionTenths?` | Optional. |
| `LookPlaylist.durationsTenths?: number[]`, `repeat?`, `endSlot?` | Optional. Absent means today's single `durationTenths` and forever. |
| `LooksDocument.schedule` → `scheduleRows: ScheduleRow[]` (version 2) | Read version 1 and migrate the single nightly row into a list. |
| Per-Light sent digests per Look, playlist and schedule | Extends `LastLookPush` / `lookPushDigest`. Drives "not sent" and the Send dialog's change list. |
| Section colour on the prop | Today `styleFor` falls back to a section's stored colour before the Look colour. In this model Follow means the prop's style. A one-time migration writes explicit section "Own" overrides for any Look that shows a section colour today, so nothing on the lights changes. The section colour is then just the seed when you pick Own. |

New server routes: `GET /api/lights/:id/effects` (cached catalog), `POST /api/looks/:id/preview` and `/preview/end` (whole-yard Preview with effects, through the live engine with restore), `POST /api/looks/send` (today's push, renamed, with per-Light rows and Undo), `POST /api/looks/turn-on` (wraps `/api/sync/preset`), `GET /api/looks/now`, and `POST /api/looks/:id/capture` (from `nativeRestore`, which the Sync page already reads). Logic goes in `packages/shared` and the server, as #142 asked.

## Dylan's tasks, walked

| # | Task | Route in the prototype |
| --- | --- | --- |
| 1 | New Look "Christmas Eve": roofline red and white chase, windows warm white, tree twinkling green, the rest off | Looks → + New Look → "Every prop on, warm white" → name it → turn off Door arch, Wreath and both bushes in the Props list → Roofline: Own → Effect: Theater chase → Stripe #ff0000, Gap #ffffff → Tree: Own → Twinkle → green swatch. Windows already follow the warm Look style. |
| 2 | Watch it on the lights, slow the chase while it runs | Preview on lights → select Roofline → drag Speed down |
| 3 | Right half of the roofline gold | Tap the roofline again on its right half (or the Right chip) → Own style → #ffc000 |
| 4 | Put the new wreath in two Looks | Yard → "Wreath is new" → Add Wreath to Looks… → tick Christmas Eve and Warm white → Add |
| 5 | Playlist Christmas: Christmas Eve 10 min, Snowfall 5 min, repeating | Looks → Playlists → + New playlist → name → Look 1 Christmas Eve 10 → + Add a Look → Snowfall 5 |
| 6 | Christmas Nov 25–Jan 6, sunset to 11 PM, Nightly the rest of the year | Schedule → + Add to the schedule (starts as Nov 25–Jan 6, at sunset, off 11 PM) → Runs: Christmas playlist. The year bar and timer meter update. |
| 7 | Send with Garage Light unplugged | Pill → Send → results show Garage Light "Not sent", others "Up to date". The bar keeps "Garage Light: 4 not sent". |
| 8 | Party: Warm white now, until the schedule turns it off | Looks → Warm white → Turn on now. The toast and the bar say the Schedule takes over at Off, 11:00 PM. |
| 9 | Which Looks is the door arch in, and in what colour? | Looks → By prop, or select Door arch on the yard → Looks fold |

All nine pass in the prototype at 1440×900 and 390×844, walked through the UI in Playwright.

## First-use walkthrough

The prototype was walked as a first-time user at both sizes. What tripped, and the rule it became:

| Found | Rule for the build |
| --- | --- |
| A new Look started with every prop off, so task 1 began with eight clicks to switch things on. | + New Look asks how to start: every prop on (warm white), every prop off, or a copy of a Look. |
| Dots for palette effects drew black (colour 1 isn't used), and white looked like an empty circle. | A dot shows the colour the effect actually uses most, sampled from the effect. |
| On a phone the Follow / Own / Off switch collapsed to a line inside the scrolling panel. | Panel children never shrink. Every control keeps its height. |
| In a prop panel on a phone there was no way to reach another prop except tapping the drawing. | "Back to the whole Look" is always last in the prop panel, and the whole-Look panel lists every prop with its switch. |
| Labels collided on a phone-width drawing. | Below 640 px, only the selected prop is labelled. |
| The first sunset-follow maths made one timer per day (16 for Christmas). | Group days while sunset moves ≤ 10 min, and fire after the latest one. 2 timers. |
| The send pill pushed the top bar off a phone screen. | Short pill text on a phone: "4 not sent · Send". |
| "4 behind" read as jargon. | "4 not sent". |
| The test-task card covered the panel's last button. | Prototype only, but the build's toasts sit above the phone nav and never cover the panel's primary action. |

## Open questions

1. **Send model.** The recommendation is an explicit Send with an always-visible pill, plus a "Send" button in the toast after Done. The alternative is sending automatically on Done. That's simpler, but it pushes half-finished Looks to the lights at night, and a dead Light then fails silently in the background.
2. **A second sunset row.** The recommendation is clock timers that follow sunset (above), all on the device. The alternative is for Nightplot to rewrite WLED's sunset timer on each row's start date. That gives exact sunset all year, but only if Nightplot is running on those dates.
3. **Section colours on props.** These become the seed for Own rather than a silent fallback (see Data). Nothing on the lights changes.

## Slices

Each is one PR, after approval and after #142 merges. Main stays shippable after each.

1. **Look model and panel.** Follow / Own / Off in shared helpers, section-colour migration, the new style fields, and the Look view panel rewrite (mode switches, props list, multi-select, Select all, copy/paste). Builds on #142's Look view.
2. **Effects from the Lights.** Catalog route and cache, firmware intersection, effect picker, palette picker, and the shared approximate sampler for the drawing and strips.
3. **Preview on lights.** Whole-Look live Preview with effects, through the live engine with restore, with per-Light status in the chip.
4. **Send and Now.** Per-Light sent digests, top-bar pill, Send dialog with backup and Undo, Turn on now, and the "Now on the lights" bar.
5. **Looks page and yard.** Cards with live thumbnails, the New Look dialog, Duplicate, Start from what a Light shows, the By prop tab, the yard's Looks fold, and "Add to Looks…".
6. **Playlists.** Per-Look minutes, reorder, after the last Look.
7. **Schedule rows.** Schedule version 2, the timer planner in `schedule.ts` with tests, the year bar and timer meter. Needs the sunset slot fix.
8. **Cleanup.** "Turn on a preset" moves off the Sync page. The Sync page keeps copying presets and UDP sync. Playwright runs all nine tasks at both sizes.

## Sources

- WLED JSON API (fxdata format, palx, playlist fields, `info.leds.maxseg`): https://kno.wled.ge/interfaces/json-api/
- WLED presets and timers (8 timers, sunrise and sunset in the last two slots, 250 presets): https://kno.wled.ge/features/presets/
- WLED 0.15.1 source, `wled00/ntp.cpp` (`checkTimers`, `isTodayInDateRange`) and `wled00/cfg.cpp` (timer load and save, dates only on slots 0–7): https://github.com/wled/WLED/tree/v0.15.1/wled00
