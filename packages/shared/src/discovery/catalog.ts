import type { DiscoveryMechanism } from "./types.ts";

const mechanisms: readonly DiscoveryMechanism[] = [
  {
    id: "mdns",
    label: "mDNS",
    implementation: "registered",
    notes: "Looks for _wled._tcp on the link. Empty is honest when the network hides mDNS.",
  },
  {
    id: "ssdp",
    label: "SSDP",
    implementation: "registered",
    notes: "Short M-SEARCH for WLED. Secondary find path.",
  },
  {
    id: "address-probe",
    label: "Address probe",
    implementation: "registered",
    notes:
      "Type host or host:port. Public internet addresses are refused before probing.",
  },
];

export function listDiscoveryMechanisms(): readonly DiscoveryMechanism[] {
  return mechanisms;
}
