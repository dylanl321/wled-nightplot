# Split tree

A split tree is a trunk that forks. The main trunk stands on the ground. At a split, two or more branches leave in different directions, and a branch can fork again. It is not the flat triangle (**Mini tree**), not a wrap around one post (**Spiral tree**), and not a line that splits.

## The skeleton

You design the skeleton on the canvas, front-on. Drag a **circle** to move where the trunks meet. Drag a **diamond** to aim that tip. Drag a branch itself to carry the branches that grow from it. **+** beside a tip forks that tip, and the other branches stay where they are. **Fork again** in the panel does the same for the selected tip. **Add branch** adds one more limb at a selected fork. **Even tips again** puts the tree back to an even Y.

Height, split height, and tip spacing are the whole tree, in the prop's unit (feet and inches, or metres). Each trunk also has its own height and how far out its end sits. Typing one of those moves the drawing; dragging updates the number.

## The wrap

The lights coil round the wood the way a string is put up:

- **Around the trunk** is a tape round the main trunk at the ground, in inches or centimetres. Each branch starts a little thinner than the end of the trunk it grows from, and narrows toward its tip.
- **Wrap every** is how far up one wrap is from the next on the same side.
- At a fork the coil carries straight on up the first branch.
- A string cannot jump to a sibling. When it has finished one branch, it runs straight down the back of that branch to the fork, then wraps up the next one. A move that cannot be walked down the tree is a dark jump.

With no strings set, the tree is one string walked in that order: up the trunk, up the left branch, back down, up the next. **Add string** on a trunk puts a real string there, with its own LED product, spacing in centimetres, and light count; **Also on** carries it onto another trunk. A trunk no string reaches is drawn as its own coil.

The length stored on each run is the real string length along that piece of coil, not the flat line on the drawing, so light counts match the string.

## Depth

The drawing is flat, but the coil is not. Each point of the coil keeps how far it is toward the street (front of the trunk) or away (back). The editor draws the back of the coil and the runs down the back fainter. The street view puts those lights in depth, so the tree looks round from the road. The shape reader keeps the front and back of the coil apart where they cross on the drawing, so a Look that follows the wires or the height of the tree reads it as one path.

Older split trees saved with wrap-meet rings or back-path knees still open; those points are ignored and the tree is redrawn with the wrap above.
