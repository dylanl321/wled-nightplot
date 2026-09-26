import type { BeadColor } from "../bead.ts";

export type DiscoveryMechanismId = "mdns" | "ssdp" | "address-probe";

/**
 * How candidates are found.
 * `registered` means the mechanism can collect or probe. Empty results are honest.
 */
export type DiscoveryMechanism = {
  id: DiscoveryMechanismId;
  label: string;
  implementation: "registered" | "placeholder";
  notes: string;
};

export type DiscoverVia = "mdns" | "ssdp" | "address-probe" | "targets";

export type DiscoverReasonCode =
  | "disallowed-address"
  | "probe-failed"
  | "not-wled"
  | "already-added"
  | "missing-port";

export type DiscoverStatus = "found" | "rejected" | "already-added";

export type DiscoverRow = {
  key: string;
  hostname: string;
  port: number | null;
  displayHost: string;
  via: DiscoverVia;
  status: DiscoverStatus;
  reason: string | null;
  reasonCode: DiscoverReasonCode | null;
  name: string | null;
  ledCount: number | null;
  firmware: string | null;
  mac: string | null;
  on: boolean | null;
  bead: BeadColor | null;
  foundAt: string;
};
