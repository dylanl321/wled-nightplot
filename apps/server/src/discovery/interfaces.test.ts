import { describe, expect, it } from "vitest";
import type { NetworkInterfaceInfo } from "node:os";
import { discoverySendAddresses, forEachAdapter, lanIPv4s } from "./interfaces.ts";

function iface(
  address: string,
  extra?: { netmask?: string; internal?: boolean },
): NetworkInterfaceInfo {
  return {
    address,
    netmask: extra?.netmask ?? "255.255.255.0",
    family: "IPv4",
    mac: "00:00:00:00:00:00",
    internal: extra?.internal ?? false,
    cidr: null,
  };
}

const host = {
  Tailscale: [iface("169.254.83.107")],
  Ethernet: [iface("169.254.186.136")],
  "VMware Network Adapter VMnet1": [iface("192.168.61.1")],
  "Wi-Fi": [iface("10.0.3.145", { netmask: "255.255.252.0" })],
  "Loopback Pseudo-Interface 1": [iface("127.0.0.1", { internal: true })],
  "vEthernet (WSLCore)": [iface("172.20.80.1")],
};

describe("lanIPv4s", () => {
  it("keeps routable LAN addresses and skips loopback and 169.254", () => {
    expect(lanIPv4s(host)).toEqual(["10.0.3.145", "172.20.80.1", "192.168.61.1"]);
  });

  it("drops a repeated address", () => {
    expect(
      lanIPv4s({
        a: [iface("10.0.0.2")],
        b: [iface("10.0.0.2")],
      }),
    ).toEqual(["10.0.0.2"]);
  });
});

describe("discoverySendAddresses", () => {
  it("sends on every LAN address when no pin is set", () => {
    expect(discoverySendAddresses({ interfaces: host })).toEqual([
      "10.0.3.145",
      "172.20.80.1",
      "192.168.61.1",
    ]);
  });

  it("pins one literal address", () => {
    expect(discoverySendAddresses({ pin: "10.0.3.145", interfaces: host })).toEqual([
      "10.0.3.145",
    ]);
  });

  it("uses the internet-facing address when the pin is primary", () => {
    expect(
      discoverySendAddresses({
        pin: "primary",
        interfaces: host,
        primary: "10.0.3.145",
      }),
    ).toEqual(["10.0.3.145"]);
  });

  it("keeps every LAN address when primary was not resolved", () => {
    expect(discoverySendAddresses({ pin: "primary", interfaces: host })).toEqual([
      "10.0.3.145",
      "172.20.80.1",
      "192.168.61.1",
    ]);
  });

  it("ignores a pin that is not an address", () => {
    expect(discoverySendAddresses({ pin: "wifi", interfaces: host })).toEqual([
      "10.0.3.145",
      "172.20.80.1",
      "192.168.61.1",
    ]);
  });
});

describe("forEachAdapter", () => {
  it("still queries the next adapter when one refuses", async () => {
    const sent: string[] = [];
    await forEachAdapter(["169.254.186.136", "10.0.3.145"], async (address) => {
      if (address.startsWith("169.254.")) throw new Error("no");
      sent.push(address);
    });
    expect(sent).toEqual(["10.0.3.145"]);
  });
});
