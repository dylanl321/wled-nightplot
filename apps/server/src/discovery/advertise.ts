import { createRequire } from "node:module";
import { hostname as osHostname, networkInterfaces, type NetworkInterfaceInfo } from "node:os";
import { lanIPv4s } from "./interfaces.ts";

export const NIGHTPLOT_SERVICE_TYPE = "_nightplot._tcp";

/** The DNS name the PTR answer lives under. */
const PTR_NAME = `${NIGHTPLOT_SERVICE_TYPE}.local`;

/** A single mDNS record as `multicast-dns` passes it in a query or expects it in a response. */
export type MdnsQuestion = { name: string; type: string };
export type MdnsAnswer = {
  name: string;
  type: string;
  ttl?: number;
  data: unknown;
};

/**
 * The slice of the `multicast-dns` responder we use. A fake can implement this
 * for tests; the default wraps the real `multicast-dns` instance.
 */
export type Responder = {
  on(
    event: "query",
    fn: (query: { questions?: MdnsQuestion[] }, rinfo?: unknown) => void,
  ): void;
  on(event: "error" | "warning", fn: (err: Error) => void): void;
  respond(res: MdnsAnswer[], rinfo?: unknown, cb?: () => void): void;
  destroy(cb?: () => void): void;
};

export type ResponderFactory = () => Responder;

export type NetworkInterfaces = NodeJS.Dict<NetworkInterfaceInfo[]>;

export type AdvertHandle = { stop(): void };

export type AdvertDeps = {
  /** Injected in tests; default wraps `multicast-dns`. */
  responder?: ResponderFactory;
  interfaces?: () => NetworkInterfaces;
  log?: (line: string) => void;
};

/** 127.0.0.0/8, `::1`, `localhost`. `0.0.0.0` and `::` are not loopback binds. */
export function isLoopbackBind(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  if (host === "localhost") return true;
  if (host === "::1") return true;
  if (host === "0.0.0.0" || host === "::") return false;
  const parts = host.split(".");
  if (parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)) {
    return parts[0] === "127";
  }
  return false;
}

export function startAdvert(
  opts: { hostname: string; port: number; version: string },
  deps: AdvertDeps = {},
): AdvertHandle | null {
  const log = deps.log ?? ((line: string) => console.log(line));

  if (isLoopbackBind(opts.hostname)) {
    log("advert  off (loopback only)");
    return null;
  }

  const interfaces = (deps.interfaces ?? networkInterfaces)();
  const addresses = lanIPv4s(interfaces);
  const instance = `Nightplot on ${osHostname()}`;
  const instanceName = `${instance}.${NIGHTPLOT_SERVICE_TYPE}.local`;
  const target = `${osHostname()}.local`;

  const answers = (ttl: number): MdnsAnswer[] => {
    const records: MdnsAnswer[] = [
      { name: PTR_NAME, type: "PTR", ttl, data: instanceName },
      {
        name: instanceName,
        type: "SRV",
        ttl,
        data: { port: opts.port, target, weight: 0, priority: 0 },
      },
      {
        name: instanceName,
        type: "TXT",
        ttl,
        data: [`service=nightplot-configure`, `version=${opts.version}`],
      },
    ];
    for (const address of addresses) {
      records.push({ name: target, type: "A", ttl, data: address });
    }
    return records;
  };

  let responder: Responder;
  try {
    const make = deps.responder ?? defaultResponder;
    responder = make();
    responder.on("error", (err) => {
      log(`advert  failed: ${err.message}`);
    });
    responder.on("warning", (err) => {
      log(`advert  failed: ${err.message}`);
    });
    responder.on("query", (query) => {
      const asked = (query.questions ?? []).some(
        (q) => q.name === PTR_NAME && (q.type === "PTR" || q.type === "ANY"),
      );
      if (!asked) return;
      try {
        responder.respond(answers(120));
      } catch (err) {
        log(`advert  failed: ${errorMessage(err)}`);
      }
    });
  } catch (err) {
    log(`advert  failed: ${errorMessage(err)}`);
    return null;
  }

  log(`advert  ${NIGHTPLOT_SERVICE_TYPE} on ${opts.port}`);

  let stopped = false;
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      try {
        responder.respond(answers(0));
      } catch (err) {
        log(`advert  failed: ${errorMessage(err)}`);
      }
      try {
        responder.destroy();
      } catch (err) {
        log(`advert  failed: ${errorMessage(err)}`);
      }
    },
  };
}

function defaultResponder(): Responder {
  // `multicast-dns` is CommonJS and `startAdvert` is synchronous, so load it
  // synchronously through createRequire. A construction failure here is caught
  // by startAdvert and never stops the API from serving.
  const require = createRequire(import.meta.url);
  const create = require("multicast-dns") as () => Responder;
  return create();
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
