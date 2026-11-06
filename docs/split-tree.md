# Split tree

A split tree is a trunk that forks, drawn as a street-facing elevation: trunks spread left and right, height goes up. It is not the flat triangle (**Mini tree**) and not a wrap around one post (**Spiral tree**).

On the yard, pick **Split tree**. The first numbers are the general ones:

- **Trunks** — how many tips reach the top. Two is a Y. Three or more split from the same fork, spaced evenly.
- **Height** — the top of the tree, in the prop's unit (feet or metres).
- **Split height** — where the main trunk forks, from the ground.
- **Tip spacing** — the distance along the ground between neighbouring tips. Not an angle.
- **Fork again** — the main trunk splits in two, then those branches split to fill the trunk count. Two tips become four, because a second fork needs something to split into.

Each trunk then takes strings. A trunk can have none yet, one string, or several end to end. One string can continue onto another trunk. If those trunks do not meet, the drawing shows a dark jump. A string keeps its own LED product, its spacing in centimetres, and its length in metres. The trunk length stays in the prop's unit, so you can see what is still open.

Changing the general numbers draws the tree again. A string stays on a trunk whose id is still there. Sections stay on those runs.

The length stored on each run is the string length along that piece. The height of a trunk is the height of its corners, for a later effect that follows height.
