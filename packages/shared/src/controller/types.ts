export type ControllerCapability =
  | "discover"
  | "snapshot"
  | "blink"
  | "preview"
  | "apply"
  | "allOff"
  | "safe";

/**
 * A controller member talks to hardware.
 * Lights / Elements / the live stack never fork per vendor — they call through this seam.
 *
 * `registered` means the slot exists. It is not Hardware Done.
 * Capability flags stay false until that action is actually wired.
 */
export type ControllerDescriptor = {
  id: string;
  label: string;
  chip: string;
  implementation: "registered" | "placeholder";
  wired: boolean;
  capabilities: Record<ControllerCapability, boolean>;
  notes: string;
};
