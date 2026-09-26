export type StripChannel = "r" | "g" | "b" | "w";

/**
 * A strip/driver member owns channels, colour order, and the bead picture.
 * Elements (ranges) stay the same when a new strip type slots in.
 *
 * `registered` is the slot. It is not Hardware Done.
 */
export type StripDriverDescriptor = {
  id: string;
  label: string;
  chip: string;
  implementation: "registered" | "placeholder";
  wired: boolean;
  channels: readonly StripChannel[];
  colorOrder: string;
  bead: "rgb" | "rgbw";
  notes: string;
};
