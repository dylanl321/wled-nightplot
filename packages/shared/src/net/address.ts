export type HostPort = {
  hostname: string;
  port: number;
};

export type AddressDecision =
  | { ok: true; target: HostPort }
  | { ok: false; reason: string; reasonCode: "disallowed-address" };

/** Typed host with no port, and http URLs without an explicit port. Discovery must not invent this. */
const DEFAULT_PORT = 80;

const LOCAL_SUFFIXES = [".local", ".lan", ".home.arpa", ".internal"];

export function parseHostPort(raw: string): HostPort | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let value = trimmed;
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      value = url.port ? `${url.hostname}:${url.port}` : url.hostname;
    } catch {
      return null;
    }
  }

  if (value.startsWith("[")) {
    const close = value.indexOf("]");
    if (close < 1) return null;
    const hostname = value.slice(1, close);
    const rest = value.slice(close + 1);
    if (rest === "") return { hostname, port: DEFAULT_PORT };
    if (!rest.startsWith(":")) return null;
    const port = Number(rest.slice(1));
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    return { hostname, port };
  }

  const colon = value.lastIndexOf(":");
  if (colon > 0 && value.includes(".") && !value.includes("]")) {
    const maybePort = value.slice(colon + 1);
    if (/^\d+$/.test(maybePort)) {
      const port = Number(maybePort);
      if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
      return { hostname: value.slice(0, colon), port };
    }
  }

  if (colon > 0 && /^[a-zA-Z0-9-]+$/.test(value.slice(0, colon))) {
    const port = Number(value.slice(colon + 1));
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    return { hostname: value.slice(0, colon), port };
  }

  return { hostname: value, port: DEFAULT_PORT };
}

export function normalizeHostKey(target: HostPort): string {
  const host = target.hostname.trim().toLowerCase();
  return `${host}:${target.port}`;
}

export function displayHost(target: HostPort): string {
  const host = target.hostname;
  return target.port === DEFAULT_PORT ? host : `${host}:${target.port}`;
}

export function decideProbeAddress(raw: string): AddressDecision {
  const target = parseHostPort(raw);
  if (!target) {
    return {
      ok: false,
      reasonCode: "disallowed-address",
      reason: "That is not a host or host:port.",
    };
  }
  if (!isLanAllowed(target.hostname)) {
    return {
      ok: false,
      reasonCode: "disallowed-address",
      reason: "Public internet address. Refused before probing.",
    };
  }
  return { ok: true, target };
}

export function isLanAllowed(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  if (!host) return false;

  if (host === "localhost") return true;

  const ipv4 = parseIPv4(host);
  if (ipv4) return isPrivateIPv4(ipv4);

  if (host.includes(":")) return isPrivateIPv6(host);

  if (host.includes(".")) {
    return LOCAL_SUFFIXES.some((suffix) => host.endsWith(suffix));
  }

  return /^[a-z0-9-]+$/.test(host);
}

function parseIPv4(host: string): [number, number, number, number] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((part) => Number(part));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return nums as [number, number, number, number];
}

function isPrivateIPv4([a, b]: [number, number, number, number]): boolean {
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

function isPrivateIPv6(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "::1") return true;
  if (h.startsWith("fe80:")) return true;
  if (h.startsWith("fc") || h.startsWith("fd")) return true;
  return false;
}
