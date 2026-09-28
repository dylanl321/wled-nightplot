import { createSocket, type Socket } from "node:dgram";
import { networkInterfaces } from "node:os";
import { parseHostPort, type DiscoverVia } from "@nightplot/shared";
import {
  discoverySendAddresses,
  forEachAdapter,
  primaryIPv4,
} from "./interfaces.ts";
import {
  parseSsdpAdvertisement,
  resolveMdnsRecords,
  type MdnsRecordInput,
} from "./parse.ts";

const MDNS_GROUP = "224.0.0.251";
const MDNS_PORT = 5353;
const SSDP_GROUP = "239.255.255.250";
const SSDP_PORT = 1900;
const SSDP_SEARCH = [
  "M-SEARCH * HTTP/1.1",
  "HOST: 239.255.255.250:1900",
  'MAN: "ssdp:discover"',
  "MX: 1",
  "ST: urn:schemas-upnp-org:device:wled:1",
  "",
  "",
].join("\r\n");

export type Collected = {
  hostname: string;
  port: number | null;
  via: DiscoverVia;
};

export type CollectFn = () => Promise<Collected[]>;

export function parseTargetList(raw: string | undefined): Collected[] {
  if (!raw?.trim()) return [];
  const out: Collected[] = [];
  for (const part of raw.split(/[,;\s]+/)) {
    const parsed = parseHostPort(part);
    if (parsed) out.push({ ...parsed, via: "targets" });
  }
  return out;
}

export function createCollector(options: {
  targets?: string;
  mdnsMs?: number;
  ssdpMs?: number;
  /** IPv4 to send on, or `primary` for the internet-facing address. Unset sends on every LAN IPv4. */
  interface?: string;
}): CollectFn {
  return async () => {
    const found: Collected[] = [...parseTargetList(options.targets)];
    const pin = options.interface?.trim() ?? "";
    const primary = pin.toLowerCase() === "primary" ? await primaryIPv4() : undefined;
    const addresses = discoverySendAddresses({
      pin,
      interfaces: networkInterfaces(),
      primary,
    });
    const [mdns, ssdp] = await Promise.all([
      collectMdns(options.mdnsMs ?? 1500, addresses),
      collectSsdp(options.ssdpMs ?? 1500, addresses),
    ]);
    found.push(...mdns, ...ssdp);
    return dedupe(found);
  };
}

function dedupe(rows: Collected[]): Collected[] {
  const seen = new Set<string>();
  const out: Collected[] = [];
  for (const row of rows) {
    const key = `${row.hostname.toLowerCase()}:${row.port ?? "none"}:${row.via}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

async function collectMdns(ms: number, addresses: string[]): Promise<Collected[]> {
  if (addresses.length === 0) return [];
  try {
    const mod = (await import("multicast-dns")) as {
      default?: (opts?: {
        socket?: Socket;
        port?: number;
        bind?: string;
      }) => MdnsBrowser;
    };
    const create = mod.default;
    if (typeof create !== "function") return [];
    const socket = createSocket({ type: "udp4", reuseAddr: true });
    const browser = create({ socket, port: MDNS_PORT, bind: "0.0.0.0" });
    const records: MdnsRecordInput[] = [];
    return await new Promise((resolve) => {
      let settled = false;
      let listening = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          browser.destroy();
        } catch {
          /* ignore */
        }
        resolve(
          resolveMdnsRecords(records).map((hint) => ({ ...hint, via: "mdns" })),
        );
      };
      const timer = setTimeout(finish, ms);
      browser.on("error", () => {
        if (!listening) finish();
      });
      browser.on("response", (res) => {
        records.push(...(res.answers ?? []), ...(res.additionals ?? []));
      });
      browser.on("ready", () => {
        listening = true;
        void forEachAdapter(addresses, (address) =>
          queryMdns(browser, socket, address),
        );
      });
    });
  } catch {
    return [];
  }
}

function queryMdns(browser: MdnsBrowser, socket: Socket, address: string): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      socket.addMembership(MDNS_GROUP, address);
    } catch {
      /* already joined, or this adapter refuses the group */
    }
    try {
      socket.setMulticastInterface(address);
    } catch (err) {
      reject(err);
      return;
    }
    try {
      browser.query(
        { questions: [{ name: "_wled._tcp.local", type: "PTR" }] },
        () => resolve(),
      );
    } catch (err) {
      reject(err);
    }
  });
}

interface MdnsBrowser {
  on(event: "response", fn: (res: { answers?: MdnsRecordInput[]; additionals?: MdnsRecordInput[] }) => void): void;
  on(event: "error" | "ready", fn: () => void): void;
  query(
    q: { questions: { name: string; type: string }[] },
    cb?: () => void,
  ): void;
  destroy(): void;
}

async function collectSsdp(ms: number, addresses: string[]): Promise<Collected[]> {
  if (addresses.length === 0) return [];
  const found: Collected[] = [];
  const sockets: Socket[] = [];
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const socket of sockets) {
        try {
          socket.close();
        } catch {
          /* ignore */
        }
      }
      resolve(found);
    };
    const timer = setTimeout(finish, ms);
    for (const address of addresses) {
      let socket: Socket;
      try {
        socket = createSocket({ type: "udp4", reuseAddr: true });
      } catch {
        continue;
      }
      sockets.push(socket);
      socket.on("error", () => {
        try {
          socket.close();
        } catch {
          /* ignore */
        }
      });
      socket.on("message", (msg, rinfo) => {
        if (settled) return;
        const hint = parseSsdpAdvertisement(
          Buffer.isBuffer(msg) ? msg.toString("utf8") : String(msg),
          rinfo?.address ?? "",
        );
        if (hint?.hostname) found.push({ ...hint, via: "ssdp" });
      });
      try {
        socket.bind(0, address, () => {
          if (settled) return;
          try {
            socket.setMulticastInterface(address);
            socket.setMulticastTTL(1);
            socket.send(SSDP_SEARCH, SSDP_PORT, SSDP_GROUP);
          } catch {
            try {
              socket.close();
            } catch {
              /* ignore */
            }
          }
        });
      } catch {
        try {
          socket.close();
        } catch {
          /* ignore */
        }
      }
    }
  });
}
