# Security

Nightplot Configure is a **LAN utility**. It talks to WLED boxes on a home network. It is early software: there is no authentication and no TLS. Do not publish the API on the public internet.

## LAN assumptions

- The API binds `127.0.0.1:43181` by default (`NIGHTPLOT_API_HOST` / `NIGHTPLOT_API_PORT`). The web app binds `127.0.0.1:43180`.
- CORS on the API allows `http://127.0.0.1:43180` and `http://localhost:43180` by default (`apps/server/src/cors-origins.ts`). `NIGHTPLOT_CORS_ORIGINS` may add http(s) origins. `*` is ignored.
- There is **no authentication** on the API. Anyone who can reach it can enroll, Preview, Apply, provision, and All Off.
- Enrolled Lights persist in a local JSON file (`data/lights.json`, or `NIGHTPLOT_STORE_PATH`). Operator LED products persist in `data/led-products.json` (`NIGHTPLOT_LED_PRODUCTS_PATH`). Activity and managed backups sit beside that store (`activity.json`, `backups/`). Backup files are mode `0600` and may include native WLED configuration and presets. WLED excludes passwords; leftover secrets are stripped if present. Treat those exports as private even without passwords. They are not a firmware image and not whole-device recovery.

The Docker image and compose file package the same local/LAN run — see [docs/deploy.md](docs/deploy.md). They do not add authentication or TLS.

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
