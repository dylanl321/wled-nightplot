# Split tree

A split tree is a trunk that forks. The main trunk stands on the ground. At a split, two or more branches leave in different directions, and a branch can fork again. It is not the flat triangle (**Mini tree**), not a wrap around one post (**Spiral tree**), and not a line that splits.

Each trunk has thickness. Lights wrap up it, the same idea as a spiral around a post: the string coils as it climbs. A real string cannot jump to a sibling branch. After it finishes one trunk it takes a back path down the far side, then goes up the next. If the two pieces do not meet by walking the tree, the drawing shows a dark jump.

On the yard, pick **Split tree**. The first numbers are the general ones:

- **Tips** — how many tips reach the top. Two is one fork. Three or more leave the same fork, spaced evenly.
- **Height** — the top of the tree, in the prop's unit (feet or metres).
- **Split height** — where the main trunk forks, from the ground.
- **Tip spacing** — how far apart neighbouring tips are, measured along the ground. Not an angle.
- **Fork again** — the main trunk splits in two, then those branches split to fill the tip count. Two tips become four, because a second fork needs something to split into.

Each trunk then takes strings. A trunk can have none yet, one string, or several end to end. One string can continue onto another trunk. The wrap length of a trunk stays in the prop's unit, so you can see what is still open. A string keeps its own LED product, its spacing in centimetres, and its length in metres.

Changing the general numbers draws the tree again. A string stays on a trunk whose id is still there (`t0`, `t0.0`, `t0.1`, and so on). Sections stay on those runs.

The length stored on each run is the string length along that piece: the coil up a trunk, or the back path down the far side. The height of a trunk is the height of its corners, for a later effect that follows height.
