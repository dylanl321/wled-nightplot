export type DiscoveryHint = {
  hostname: string;
  port: number | null;
};

export type MdnsRecordInput = {
  type?: string;
  name?: string;
  data?: unknown;
};

export function validPort(value: unknown): number | null {
  const n =
    typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 65535) {
    return null;
  }
  return n;
}

export function dnsName(name: string): string {
  return name.replace(/\.$/, "").trim().toLowerCase();
}

/** LOCATION header value → host + port. http without an explicit port is :80 (URL default). */
export function parseLocationUrl(raw: string): DiscoveryHint | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    if (!hostname) return null;
    if (url.port) {
      const port = validPort(url.port);
      if (port == null) return null;
      return { hostname, port };
    }
    if (url.protocol === "https:") return { hostname, port: 443 };
    if (url.protocol === "http:") return { hostname, port: 80 };
    return { hostname, port: null };
  } catch {
    return null;
  }
}

export function extractSsdpLocation(body: string): string | null {
  const match = body.match(/^location:\s*(.+?)\s*$/im);
  const value = match?.[1]?.trim();
  return value || null;
}

/**
 * SSDP NOTIFY / M-SEARCH reply. Port comes from LOCATION when present.
 * No LOCATION (or an unparseable one) keeps the UDP source host and leaves port unset.
 */
export function parseSsdpAdvertisement(
  body: string,
  fallbackAddress = "",
): DiscoveryHint | null {
  const location = extractSsdpLocation(body);
  if (!location) {
    if (!fallbackAddress.trim()) return null;
    return { hostname: fallbackAddress.trim(), port: null };
  }
  const parsed = parseLocationUrl(location);
  if (!parsed) {
    if (!fallbackAddress.trim()) return null;
    return { hostname: fallbackAddress.trim(), port: null };
  }
  return {
    hostname: parsed.hostname || fallbackAddress.trim(),
    port: parsed.port,
  };
}

/**
 * Pair `_wled._tcp` SRV ports with A/AAAA addresses from the same browse.
 * Other services on the link are ignored. A `_wled._tcp` SRV with no usable
 * port stays port-unset — never a silent :80. A bare address with no
 * `_wled._tcp` SRV is not a candidate.
 */
export function resolveMdnsRecords(records: MdnsRecordInput[]): DiscoveryHint[] {
  const srvs: { target: string; port: number | null }[] = [];
  const addrs: { name: string; ip: string }[] = [];

  for (const rec of records) {
    if (rec.type === "SRV" && rec.data && typeof rec.data === "object") {
      const name = dnsName(String(rec.name ?? ""));
      if (!isWledTcpService(name)) continue;
      const data = rec.data as { target?: unknown; port?: unknown };
      if (typeof data.target === "string" && data.target.trim()) {
        srvs.push({
          target: dnsName(data.target),
          port: validPort(data.port),
        });
      }
    }
    if (
      (rec.type === "A" || rec.type === "AAAA") &&
      typeof rec.data === "string" &&
      rec.data.trim()
    ) {
      addrs.push({
        name: dnsName(String(rec.name ?? "")),
        ip: rec.data.trim(),
      });
    }
  }

  const out: DiscoveryHint[] = [];

  for (const srv of srvs) {
    const matched = addrs.filter((addr) => addr.name === srv.target);
    if (matched.length) {
      for (const addr of matched) {
        out.push({ hostname: addr.ip, port: srv.port });
      }
    } else if (srv.target) {
      out.push({ hostname: srv.target, port: srv.port });
    }
  }

  return dedupeHints(out);
}

function isWledTcpService(name: string): boolean {
  return name.endsWith("._wled._tcp.local");
}

function dedupeHints(rows: DiscoveryHint[]): DiscoveryHint[] {
  const seen = new Set<string>();
  const out: DiscoveryHint[] = [];
  for (const row of rows) {
    const key = `${row.hostname.toLowerCase()}:${row.port ?? "none"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}
