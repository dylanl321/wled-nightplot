/**
 * How candidates are found. R0 only registers the slots.
 * Nothing is scanned; a stub here is not a live find.
 */
export type DiscoveryMechanism = {
  id: string;
  label: string;
  implementation: "placeholder";
  notes: string;
};
