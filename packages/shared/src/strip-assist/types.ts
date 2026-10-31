/**
 * Strip-assist plugins are modular help on Strip. They do not own the LED
 * catalog and they do not replace attach. Find length is the first member.
 * Add prop is the segment helper — its walk lives on Segments, not Strip.
 */

export const STRIP_ASSIST_KINDS = ["length", "segment"] as const;
export type StripAssistKind = (typeof STRIP_ASSIST_KINDS)[number];

export type StripAssistPlugin = {
  id: string;
  kind: StripAssistKind;
  label: string;
  implementation: "registered";
  /** Assist talks through Preview / provision — it is not a local LED driver. */
  wired: false;
  notes: string;
};
