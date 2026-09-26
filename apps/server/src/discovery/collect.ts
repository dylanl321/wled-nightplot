import { createSocket } from "node:dgram";
import { parseHostPort, type DiscoverVia, type HostPort } from "@nightplot/shared";

export type Collected = HostPort & { via: DiscoverVia };

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
    const key = `${row.hostname.toLowerCase()}:${row.port}:${row.via}`;
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
    const found: Collected[] = [];
    return await new Promise((resolve) => {
      const finish = () => {
        try {
          browser.destroy();
        } catch {
          /* ignore */
        }
        resolve(found);
      };
      const timer = setTimeout(finish, ms);
      browser.on("response", (res) => {
        const records = [...(res.answers ?? []), ...(res.additionals ?? [])];
        for (const rec of records) {
          if (rec.type === "SRV" && rec.data && typeof rec.data === "object") {
            const data = rec.data as { target?: string; port?: number };
            if (data.target) {
              found.push({
                hostname: String(data.target).replace(/\.$/, ""),
                port: data.port || 80,
                via: "mdns",
              });
            }
          }
          if ((rec.type === "A" || rec.type === "AAAA") && typeof rec.data === "string") {
            found.push({ hostname: rec.data, port: 80, via: "mdns" });
          }
        }
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
  on: (event: "response", fn: (res: { answers?: MdnsRec[]; additionals?: MdnsRec[] }) => void) => void;
  query: (q: { questions: { name: string; type: string }[] }) => void;
  destroy: () => void;
};

type MdnsRec = {
  type?: string;
  data?: unknown;
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
    socket.on("message", (_msg, rinfo) => {
      if (rinfo?.address) {
        found.push({ hostname: rinfo.address, port: 80, via: "ssdp" });
      }
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
