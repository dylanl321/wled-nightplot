import type { DiscoveryMechanism } from "./types.ts";

const mechanisms: readonly DiscoveryMechanism[] = [
  {
    id: "mdns",
    label: "mDNS",
    implementation: "placeholder",
    notes: "Controllers appear as each one answers. Not wired in R0.",
  },
  {
    id: "ssdp",
    label: "SSDP",
    implementation: "placeholder",
    notes: "Secondary find path. Not wired in R0.",
  },
  {
    id: "address-probe",
    label: "Address probe",
    implementation: "placeholder",
    notes:
      "Type host or host:port. Public internet addresses must be refused before probing. Not wired in R0.",
  },
];

export function listDiscoveryMechanisms(): readonly DiscoveryMechanism[] {
  return mechanisms;
}
