import type { BeadColor } from "@nightplot/shared";
import { StripBeads } from "@/components/strip-beads";

export function MiniStrip({
  id,
  bead,
  count = 36,
  pitch = 4.8,
}: {
  id: string;
  bead: BeadColor;
  count?: number;
  pitch?: number;
}) {
  return (
    <StripBeads
      id={id}
      count={count}
      color={() => bead}
      pitch={pitch}
      gutter={0}
      top={3}
      bottom={3}
      brightness={bead && bead !== "unknown" ? 0.8 : 1}
      ariaLabel="LED strip"
    />
  );
}
