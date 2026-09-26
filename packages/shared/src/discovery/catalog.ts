import type { DiscoveryMechanism } from "./types.ts";

const mechanisms: readonly DiscoveryMechanism[] = [
  {
    id: "mdns",
    label: "mDNS",
    implementation: "registered",
    notes:
      "Looks for _wled._tcp on the link. Port comes from the SRV record. An A/AAAA without a service port is listed as needs host:port — never a silent :80. Empty is honest when the network hides mDNS.",
  },
  {
    id: "ssdp",
    label: "SSDP",
    implementation: "registered",
    notes:
      "Short M-SEARCH for WLED. Port comes from LOCATION. No LOCATION → needs host:port, not a guessed :80. An http LOCATION without an explicit port is :80 (URL default).",
  },
  {
    id: "address-probe",
    label: "Address probe",
    implementation: "registered",
    notes:
      "Type host or host:port. A host with no port means :80 (typed default). Public internet addresses are refused before probing. Typed address is the escape hatch when find has no port.",
  },
];

export function listDiscoveryMechanisms(): readonly DiscoveryMechanism[] {
  return mechanisms;
}
