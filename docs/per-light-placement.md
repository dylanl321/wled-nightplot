# Per-light placement

Plan only. Do not build this until it is accepted. A dot on the drawing is not a lit pixel. Preview is temporary. Apply persists. Not Hardware Done. Nothing in this plan is sent to a controller.

Checked against the path model on main: a run is a `LayoutEdge` with a stable `id`, a length, and either `round(length ÷ pitch)` lights or a typed `lockedLights`. Individual light positions are not stored. Section index ranges come from `pathEdgeIndexRanges`: on each string, the first light is 0, and each run consumes its count in order. A wireframe ledmap is a separate list (`formatLedmapJson`). Looks already say a ledmap is not written for sections.

## Data

Lights belong to the run, keyed by the run's `id`, not by the badge (A12). A split or a new point must not move a hand-placed light onto another run. The run that keeps the id keeps its lights. The new piece starts without them.

On a lit run:

```ts
type PlacedLight = {
  /** Stable id. Never reused (`retiredIds`). */
  id: string;
  /** Metres from this run's start corner, along the straight run. */
  alongM: number;
};

// On LayoutEdge, lit runs only:
manualLights?: boolean;
lights?: PlacedLight[];
```

`alongM` is stored in metres, like corners. It is clamped to the run, from 0 at `from` to the run's length at `to`.

When `manualLights` is absent or false, the run works as it does today. The count is `lockedLights` if the operator typed one, otherwise `round(length ÷ pitch)`. Positions are not stored. They are an even spacing along the run, used only for drawing.

When the operator drags a light, adds one, or removes one, set `manualLights` and store `lights`. The count sections and Attach use is `lights.length`. Keep `lockedLights` equal to that length so older readers that only know the typed count still see it. A later length edit on that run does **not** clear the list and does **not** recompute positions. The lights stay where they were put, clamped if the run gets shorter than the furthest `alongM`. Clearing the lock (a control on that run, "Space evenly again") drops `lights` and `manualLights`, and the run counts from its length again.

A dark run (`kind: "wire"`) has no lights and cannot take the lock.

## Drawing

Draw lights only when zoomed in, as numbered dots on the run. One spacing should be at least about 16 px before a dot appears, so a yard full of props does not get a node per pixel. The stage maximum has to leave a single 10 cm light large enough to grab (a few hundred pixels). Below that zoom, the run is the line and the badge, as now.

The number on the dot is the light's place on the string, starting at 0 at the wire-in. That is the same number Name sections already uses. It is not the badge, and it is not a number painted by hand. Sort the run's lights by `alongM` to get their order on that run, then continue the count from the previous run on the same string. Dragging a light past another one on the same run changes their order, so the numbers follow. The light's `id` does not change.

Dots are Konva shapes on the run, hit-tested like corners. They are not drawn for a run that is off the screen.

## Editing

- **Drag** a dot and it stays on its run. Project the pointer onto the segment, clamp to the run, write `alongM`, and set the lock. It cannot jump to another run.
- **Add** a light by choosing the run and clicking where it should sit. The new light gets a new id and an `alongM` at the click. The lock turns on.
- **Remove** the selected light. Its id is retired. The lock stays on. The later numbers on the string move down, the same way a smaller count already moves section indexes.

Undo and redo store the run, including the list, the way a corner move does today.

## Sections and the ledmap

Section index ranges stay derived. A run with the lock contributes `lights.length` indexes, in string order, instead of `round(length ÷ pitch)`. Pinned ranges stay typed indexes. They do not store light ids. Changing a count still moves the indexes after that run, as it does today.

World position of a light is the point that far along the run: `from + (to − from) × (alongM ÷ length)`. That point is what a later ledmap would turn into a cell. WLED's ledmap is a list from LED index to a cell, which a preset turns on. Nightplot already formats that JSON for a wireframe. A section that is one contiguous range does not need a ledmap. A section of several ranges is already several segments. Building a ledmap from these points, and writing it, is a later slice. This plan does not write one, and it does not change Apply.

## What xLights is worth copying

xLights' custom model is a grid. You click or type the next node number into a cell. Empty cells are allowed. The number is the order on the wire, not the order of the cells on the screen. Zoom is a step in and a step out. The start channel is separate from how many nodes the model has.

Take from that:

- One numbering, the wiring order, starting at the wire-in. Do not keep a second number for "where it sits on the grid."
- A light the operator placed stays put until they say to space the run evenly again.
- Do not draw every light when the whole prop fits on the screen.
- Undo a placement the same way as any other edit.

Leave the grid. A Nightplot run is a length in metres, not a sheet of cells. Position is `alongM` on that run.

## Out of this plan

Arcs, dragging a light onto another run, a ledmap write, and Apply. Those wait.
