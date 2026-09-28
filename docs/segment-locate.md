# Edit and locate Segments

Open a Light’s **Segments** tab. The strip card brings together the current
focus, temporary Preview, keyboard hints, cursor controls and Zoom.

## Click a node, then use the arrows

**Select (V)** gives the arrows one visible target:

- Click a Segment’s first or last LED to grab its **start** or **stop** edge.
  A one-LED Segment selects its stop edge.
- Click inside a Segment to shift the whole Segment between its neighbours.
- Click a free LED to anchor a selection. Arrows grow or shrink its other end.
- Shift-click Segments to select several for **Combine into one** or **Delete all**.
  The arrows then move the cursor.

**← / →** moves the focus one LED; **Shift** moves ten. **Tab** cycles the
Segment, its start edge and its stop edge; **Shift + Tab** reverses the cycle.
**Esc** closes options first, then steps from an edge to its Segment, then
clears the selection. The keys bar names the focus and its available actions.

Touching Segments share a boundary. Moving that edge resizes both Segments,
keeping at least one LED in each. Hold **Alt / ⌥** while pressing an arrow or
dragging to leave the neighbour in place. A whole Segment cannot shift through
its neighbour; grab the shared edge instead. Consecutive arrows on the same
target within 1.2 seconds form one Undo step. Clicking an edge without dragging
does not resize it.

Hover shows a separate, faint marker and does not move the clicked cursor.
**Locate (L)** follows the pointer without editing ranges. Zoom follows the
focused cursor, or the cut boundary when using **Cut (C)**. Keyboard shortcuts
leave typing in inputs alone. Toolbar button clicks do not disable arrow keys.
The **Shortcuts** popover lists the available keys.

## Create and change Segments

**Pick LEDs (R)** selects across existing Segments. Drag and release to open
selection options, or click and use arrows before pressing **Enter** for options.
**N** creates a Segment from the selected LEDs. A single click never opens the
options menu automatically.

You can also mark a range:

1. Move the cursor to its first LED and press **Mark start** (or **[**).
2. Move to its last LED and press **Mark end** (or **]**).
3. Review the selection options and choose **New Segment**.

Both marked LEDs are included, even when marking backward. The saved range
still uses an exclusive stop: LEDs 3–7 become `[3, 8)`. Options name any
existing Segments that creation will take LEDs from. **Undo** reverses the draft
change. Save stores the draft; Apply persists the ranges to the controller.

The list shows each Segment’s range, count, calculated length (when its LED
product defines spacing), and range check. Its **Free** footer offers **+ Add**
for unused runs. The Inspector holds name and range fields, **Duplicate**,
**Split in half**, **Cut at cursor**, and **Delete**. Its range stepper buttons
grab the corresponding edge and use the same shared-boundary behavior as arrows.

## Cursor and Preview

**Light on strip** enables temporary Preview. Its summary opens the lighting
options: **Cursor only**, or **Segments stay lit** with a bright cursor.
**Segment brightness** starts at **35%** and controls other Segment LEDs from
0–100%. It does not change saved colors or overall controller brightness.
The focused node stays bright, including while an edge or Segment moves.

**Count off · every 10th LED** lights the entire strip dimly and marks the
10th, 20th, 30th… LEDs in a bright, different colour. It counts from the first
LED (zero-based indices 9, 19, 29…). This is a stationary Preview, not a
moving chase or a range edit. It needs the same restorable pixel Preview state
as Segments stay lit and is offered for strips up to 2560 LEDs; longer strips
would exceed the 512-span Preview limit, so the option is disabled rather than
showing an incomplete count. End Preview restores the previous look; All Off
cancels without restoring. No count-off colour or range is saved or Applied.

**Find an LED · halve the strip** helps locate the LED at a physical spot
(for example, a corner). With Preview on, it lights the lower-index half of
the remaining range. Look at *that spot* and choose **Lit at my spot** if an
LED there is lit, or **Not lit at my spot** if it is dark. Each answer keeps
the corresponding half and lights half again, until one zero-based LED remains.
For five LEDs, the first check lights LEDs 0–2; a Lit answer checks 0–1 next,
and a Not lit answer checks 3. **Start over** returns to the whole strip;
**Leave search** returns to Cursor only. Answer only after Preview confirms
the latest check. If Preview pauses, Retry or end it instead of guessing.
This is temporary lighting, not an edit to Segments or the length helper.

Use the cursor’s LED number or −/+ buttons to move it. **Phone remote** on the
Segments strip opens a full-screen view with large previous/next LED buttons
and the current zero-based LED number. Start Preview there to light that cursor
on the strip; End Preview requests restoration of the previous look. Returning
to Segments also ends Preview through the same sender, after any in-flight hop.
If restoration cannot be confirmed, the Segments page says so; reload the Light
or use All Off. The remote does not edit, Save, or Apply Segments. It uses
Cursor only; the separate fill-and-cursor decision is not part of this mode.

Use **‹ Edge / Edge ›** and
**‹ Free / Free ›** jump to boundaries and unused runs. **Home / End** jump to
the strip ends. Choose the scan direction and 1, 3, 5, or 10 LEDs/s, then press
**Scan**; **Pause** holds the cursor. **Space** toggles scanning when not typing
or activating a button. Scan enables Preview if needed and stops at the strip
end. It pauses when the tab is hidden, Preview ends or fails, All Off runs, or
a Segment or LED selection takes focus. It does not restart automatically.

## Preview and restoration

Segments stay lit uses WLED individual-pixel writes on the supported firmware
family (0.14.x, 0.15.x and 16.x), with one fixed full-strip canvas and compact
color ranges. Cursor movement does not create additional controller segments.
The sender allows one request in flight and replaces pending positions with
the latest one, rather than accumulating a queue.

Before opening this mode, Nightplot needs a complete native state with known
segment IDs, colors, power, brightness, grouping and orientation. Already
frozen segments and active playlists refuse this mode because their look cannot
be reconstructed from the available snapshot. The error names a frozen state
or playlist explicitly and says **Nothing was sent**, rather than claiming an
unconfirmed write.

If the controller is frozen and Nightplot has no original snapshot, **End
Preview** cannot recover that look. The page offers **Recover Preview…**, then
explains the loss before **Clear frozen LEDs** sends anything. Recovery checks
the controller identity, strip length and complete state, clears only its known
frozen ranges, and reads back to confirm. Saved Segments stay unchanged and
Preview stays off. Clearing frozen pixels discards their per-LED colours; it
does not reconstruct the previous look. Restoring a saved look in WLED is
another option. An active playlist must be stopped in WLED before trying this mode.
Missing controller fields or unsupported firmware still refuse without writing.

Recovery uses `POST /api/lights/:id/preview/recover` with
`{ "discardFrozenPixels": true }`. It shares the Light's Preview/Blink queue,
refuses while a live session owns the restore snapshot, and respects All Off
cancellation. An uncertain write or readback remains unconfirmed and is never
retried automatically. Refresh before deciding to retry.

End Preview clears the temporary pixels and restores the captured segment
settings, including white channels and effects. A failed write or restoration
retains the original snapshot for another end attempt. These snapshots are
in memory: restarting the server during Preview does not restore them.
All Off deliberately cancels without restoring.

A single controller range may cover several Segments on this page. The mismatch
banner lists those Segments together and names the controller range once.
It describes range differences; that alone is not a reason for Preview to fail.

“Elements” is now “Segments” in operator-facing copy. Existing `elements`
storage and API fields, `Element` TypeScript types, legacy links, and saved
custom labels remain compatible.

Validation covers shared boundaries, focus, drag thresholds, undo, selection options,
scan controls and Preview recovery with automated tests, plus desktop/mobile
browser checks using mocked controller responses. These are software checks;
they do not prove a physical strip lit or met a latency target.
