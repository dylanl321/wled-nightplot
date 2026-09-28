# Locate and create Segments

Open a Light’s **Segments** tab. **Show on the real strip** enables temporary
Preview. **Segments stay lit** keeps every declared Segment visible with a
bright cursor inside Segments and in unused ranges.

**Background brightness** controls the other Segment LEDs from 0–100%. It
starts at **35%**. Lower it to make the cursor easier to follow. The cursor
keeps its Preview color and overall brightness; the slider does not change
saved Segment colors or Apply settings.

The cursor stays at its position when the mouse leaves the strip. Use the
position slider, LED number, or ±1 buttons to move it. **Previous/Next edge**
and **Previous/Next unused range** jump to useful places.

For hands-free movement, choose **Forward** or **Backward**, select 1, 3, 5,
or 10 LEDs/s, and press **Auto-scan**. Auto-scan enables Preview if needed.
**Pause scan** holds the current LED. Scanning stops at the strip end and
pauses when the tab is hidden, Preview ends or fails, or All Off runs.
It does not resume automatically after returning to the tab.

With the browser focused, press **L** to locate, then **←/→** to step one LED,
or **Shift + ←/→** to step ten. **Home/End** jump to the strip ends.
Keyboard shortcuts do not intercept typing in form controls. Focus the Locate
panel and press **Space** to scan or pause. The mouse can be outside the strip
or browser window while scanning; these are not system-wide keyboard shortcuts.

To create a Segment:

1. Move the cursor to its first LED and press **Mark start** (or **[**).
2. Move to its last LED and press **Mark end** (or **]**).
3. Review the selected LEDs and press **Create Segment**.

Both marked LEDs are included, even when marking backward. The saved range
still uses an exclusive stop: LEDs 3–7 become `[3, 8)`. If the selection uses
existing Segments, the panel names them before creation. **Undo** reverses the
draft change. Save/Apply retain their existing meanings.

## Preview and restoration

Segments stay lit uses WLED individual-pixel writes on the supported firmware
family (0.14.x, 0.15.x and 16.x), with one fixed full-strip canvas and compact
color ranges. Cursor movement does not create additional controller segments.
The sender allows one request in flight and replaces pending positions with
the latest one, rather than accumulating a queue.

Before opening this mode, Nightplot needs a complete native state with known
segment IDs, colors, power, brightness, grouping and orientation. Already
frozen segments and active playlists refuse this mode because their look cannot
be reconstructed from the available snapshot. The refusal offers Refresh or
Cursor only and sends nothing.

End Preview clears the temporary pixels and restores the captured segment
settings, including white channels and effects. A failed write or restoration
retains the original snapshot for another end attempt. These snapshots are
in memory: restarting the server during Preview does not restore them.
All Off deliberately cancels without restoring.

“Elements” is now “Segments” in operator-facing copy. Existing `elements`
storage and API fields, `Element` TypeScript types, legacy links, and saved
custom labels remain compatible.

Validation uses reducer/UI tests, server tests and the HTTP fixture. Fixture
readback is software evidence, not proof a physical strip lit or met a latency
target. Desktop/mobile visual checks and physical timing still need validation.
