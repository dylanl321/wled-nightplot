import { createSocket } from "node:dgram";
import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";

export function lanIPv4s(
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces(),
): string[] {
  const found = new Set<string>();
  for (const entries of Object.values(interfaces)) {
    if (!entries) continue;
    for (const entry of entries) {
      if (!isIPv4Family(entry.family) || entry.internal) continue;
      if (isLinkLocalIPv4(entry.address)) continue;
      found.add(entry.address);
    }
  }
  return [...found].sort();
}

/**
 * Addresses Find will send on.
 * Unset pin: every LAN IPv4 (no loopback, no 169.254.0.0/16).
 * `primary`: the address the OS would use toward the internet, when that lookup worked.
 * An IPv4 literal: that address only.
 * Anything else is ignored and Find sends on every LAN IPv4.
 */
export function discoverySendAddresses(input: {
  pin?: string;
  interfaces?: NodeJS.Dict<NetworkInterfaceInfo[]>;
  primary?: string;
}): string[] {
  const pin = input.pin?.trim() ?? "";
  const interfaces = input.interfaces ?? networkInterfaces();
  if (!pin) return lanIPv4s(interfaces);
  if (pin.toLowerCase() === "primary" && input.primary && isIPv4(input.primary)) {
    return [input.primary];
  }
  if (isIPv4(pin)) return [pin];
  return lanIPv4s(interfaces);
}

/** Source address for a route to the public internet. Sends no packet. */
export function primaryIPv4(): Promise<string | undefined> {
  return new Promise((resolve) => {
    const socket = createSocket("udp4");
    let settled = false;
    const finish = (address?: string) => {
      if (settled) return;
      settled = true;
      try {
        socket.close();
      } catch {
        /* ignore */
      }
      resolve(address);
    };
    socket.once("error", () => finish());
    try {
      socket.connect(53, "1.1.1.1", () => {
        const bound = socket.address();
        finish(typeof bound === "object" ? bound.address : undefined);
      });
    } catch {
      finish();
    }
  });
}

export async function forEachAdapter(
  addresses: readonly string[],
  send: (address: string) => Promise<void>,
): Promise<void> {
  for (const address of addresses) {
    try {
      await send(address);
    } catch {
      /* this adapter did not take the query */
    }
  }
}

export function isIPv4(value: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    const n = Number(part);
    return n <= 255;
  });
}

function isLinkLocalIPv4(address: string): boolean {
  return address.startsWith("169.254.");
}

function isIPv4Family(family: NetworkInterfaceInfo["family"]): boolean {
  return family === "IPv4" || (family as unknown) === 4;
}
