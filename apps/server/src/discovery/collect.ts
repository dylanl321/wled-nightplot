import { createSocket } from "node:dgram";
import { parseHostPort, type DiscoverVia } from "@nightplot/shared";
import {
  parseSsdpAdvertisement,
  resolveMdnsRecords,
  type MdnsRecordInput,
} from "./parse.ts";

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
}): CollectFn {
  return async () => {
    const found: Collected[] = [...parseTargetList(options.targets)];
    const [mdns, ssdp] = await Promise.all([
      collectMdns(options.mdnsMs ?? 1500),
      collectSsdp(options.ssdpMs ?? 1500),
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

async function collectMdns(ms: number): Promise<Collected[]> {
  try {
    const mod = (await import("multicast-dns")) as {
      default?: () => MdnsBrowser;
    };
    const create = mod.default;
    if (typeof create !== "function") return [];
    const browser = create();
    const records: MdnsRecordInput[] = [];
    return await new Promise((resolve) => {
      const finish = () => {
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
      browser.on("response", (res) => {
        records.push(...(res.answers ?? []), ...(res.additionals ?? []));
      });
      try {
        browser.query({
          questions: [{ name: "_wled._tcp.local", type: "PTR" }],
        });
      } catch {
        clearTimeout(timer);
        finish();
      }
    });
  } catch {
    return [];
  }
}

type MdnsBrowser = {
  on: (
    event: "response",
    fn: (res: { answers?: MdnsRecordInput[]; additionals?: MdnsRecordInput[] }) => void,
  ) => void;
  query: (q: { questions: { name: string; type: string }[] }) => void;
  destroy: () => void;
};

async function collectSsdp(ms: number): Promise<Collected[]> {
  return new Promise((resolve) => {
    const found: Collected[] = [];
    let socket: ReturnType<typeof createSocket>;
    try {
      socket = createSocket({ type: "udp4", reuseAddr: true });
    } catch {
      resolve([]);
      return;
    }
    const finish = () => {
      try {
        socket.close();
      } catch {
        /* ignore */
      }
      resolve(found);
    };
    const timer = setTimeout(finish, ms);
    socket.on("error", () => {
      clearTimeout(timer);
      finish();
    });
    socket.on("message", (msg, rinfo) => {
      const hint = parseSsdpAdvertisement(
        Buffer.isBuffer(msg) ? msg.toString("utf8") : String(msg),
        rinfo?.address ?? "",
      );
      if (hint?.hostname) found.push({ ...hint, via: "ssdp" });
    });
    socket.bind(0, () => {
      try {
        socket.setBroadcast(true);
        const body = [
          "M-SEARCH * HTTP/1.1",
          "HOST: 239.255.255.250:1900",
          'MAN: "ssdp:discover"',
          "MX: 1",
          "ST: urn:schemas-upnp-org:device:wled:1",
          "",
          "",
        ].join("\r\n");
        socket.send(body, 1900, "239.255.255.250");
      } catch {
        clearTimeout(timer);
        finish();
      }
    });
  });
}
