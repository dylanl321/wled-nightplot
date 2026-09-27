# Security

Nightplot Configure is a **LAN utility**. It talks to WLED boxes on a home network. It is not hardened for the public internet.

The product is not production-ready. This file records the assumptions that are already in the tree.

## LAN assumptions

- The API binds `127.0.0.1:43181` by default (`NIGHTPLOT_API_HOST` / `NIGHTPLOT_API_PORT`). The web app binds `127.0.0.1:43180`.
- CORS on the API allows `http://127.0.0.1:43180` and `http://localhost:43180` only (`apps/server/src/app.ts`).
- There is **no authentication** on the API. Anyone who can reach it can enroll, Preview, Apply, provision, and All Off.
- Enrolled Lights persist in a local JSON file (`data/lights.json`, or `NIGHTPLOT_STORE_PATH`). That file is not a secret store.

Do not publish the API on a public interface and call it done. Docker / compose / GHCR is CONFIG-45 and is not in this repo yet.

## Discovery refuses public IPs

Find and typed-address probe go through `decideProbeAddress` / `isLanAllowed` in `packages/shared/src/net/address.ts`.

Refused **before any HTTP**:

- Public IPv4 / IPv6
- Anything that is not a host or `host:port`

Allowed:

- Loopback (`127.0.0.0/8`, `::1`, `localhost`)
- RFC1918 (`10/8`, `172.16/12`, `192.168/16`)
- Link-local IPv4 (`169.254/16`) and IPv6 (`fe80:`)
- Unique-local IPv6 (`fc` / `fd`)
- Names ending in `.local`, `.lan`, `.home.arpa`, `.internal`
- A single-label hostname (`^[a-z0-9-]+$`)

A refuse is `disallowed-address` with reason **Public internet address. Refused before probing.**

This is a guard, not a sandbox. It does not make Preview / Apply / provision safe on an untrusted LAN.

## How to report

- **LAN-guard bypass or a way to reach a public address through Find / probe / enroll:** use [GitHub Security Advisories](https://github.com/dylanl321/wled-nightplot/security/advisories) on this repo. Do not file a public issue with a working bypass.
- **Everything else** (honesty bugs, fail-closed misses, docs): a GitHub issue is fine. Use Lights / Elements language. See [CONTRIBUTING.md](CONTRIBUTING.md).

There is no separate security mailbox. Do not invent one.
