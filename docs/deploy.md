# Deploy

Nightplot Configure is a LAN utility. This page is how to run the **production-shaped** Docker image and compose file. The product is **not production-ready** and **not production certified**. There is no auth, no TLS, no public-internet recipe.

`pnpm dev` on loopback is still the supported operator path. See [install.md](install.md).

## What the image is

One image, three processes (`docker-entrypoint.sh`):

| Command | Process |
| --- | --- |
| `api` | Hono (`@nightplot/server`) on `NIGHTPLOT_API_HOST`:`NIGHTPLOT_API_PORT` |
| `web` | `next start` on `NIGHTPLOT_WEB_HOST`:`NIGHTPLOT_WEB_PORT` |
| `all` | both (default `CMD`) |

`docker-compose.yml` runs **two services** (web + api) from that image. The web build bakes Next rewrites to `http://api:43181` (the compose service name). Browser fetches stay same-origin on the web port; the Next server proxies `/api/*` and `/health`.

One-container `all` needs the API hostname:

```bash
docker run --add-host=api:127.0.0.1 -p 43180:43180 -p 43181:43181 …
```

## Build

```bash
docker build -t nightplot-configure .
```

Optional build-arg (default is already the compose name):

```bash
docker build --build-arg NIGHTPLOT_API_URL=http://api:43181 -t nightplot-configure .
```

## Compose (bridge)

```bash
docker compose up --build
```

| Publish | What |
| --- | --- |
| `43180` | Web |
| `43181` | API |

Volume `lights-store` → `/data/lights.json` (`NIGHTPLOT_STORE_PATH`).

Compose **does not** `env_file` [`.env.example`](../.env.example). That file is the loopback `pnpm dev` default. A loopback bind *inside* the container is not reachable from the published port. Compose sets `0.0.0.0` and `NIGHTPLOT_API_URL=http://api:43181` on purpose.

Pass-through only:

- `NIGHTPLOT_DISCOVERY_TARGETS` — typed Find extras (`host` or `host:port`)
- `NIGHTPLOT_CORS_ORIGINS` — extra API CORS origins (see below)

Open `http://127.0.0.1:43180`. Typed address enroll still works from the container (the API probes the LAN). Preview is not Apply. A fixture report is not Hardware Done.

`docker compose config` must validate this file.

## Find (mDNS / SSDP) — honest limits

From a **bridge** network, multicast Find often sees nothing. That is expected. Typed address and `NIGHTPLOT_DISCOVERY_TARGETS` are the escape hatch.

The honest Find path on **Linux** is host networking:

```bash
docker compose -f docker-compose.host.yml up --build
```

That file is a standalone compose (one service, `all`, `network_mode: host`, `--add-host=api:127.0.0.1`). It is not merged with the bridge file.

Docker Desktop / a VM is not a Linux LAN. Host networking there does not make mDNS/SSDP magically work. Type `host:port`.

## CORS

API defaults remain `http://127.0.0.1:43180` and `http://localhost:43180` (`apps/server/src/cors-origins.ts`). The browser path uses same-origin `/api` through Next, so CORS is not the usual compose path.

If something hits the API from another published web origin, set `NIGHTPLOT_CORS_ORIGINS` to a comma-separated list of http(s) origins. Defaults stay. `*` and wildcards are ignored (fail-closed). `pnpm dev` is unchanged when the variable is unset.

## One-container run

```bash
docker build -t nightplot-configure .
docker run --rm \
  --add-host=api:127.0.0.1 \
  -p 43180:43180 -p 43181:43181 \
  -v nightplot-lights:/data \
  -e NIGHTPLOT_STORE_PATH=/data/lights.json \
  nightplot-configure
```

Override the process: `docker run … nightplot-configure api`.

## GHCR workflow

[`.github/workflows/docker.yml`](../.github/workflows/docker.yml) builds the image.

- **Does not run on pull requests.**
- Triggers: `workflow_dispatch`, push to `main`, `v*` tags.
- How to run by hand: GitHub → Actions → Docker → Run workflow.
- Push to `ghcr.io/<owner>/<repo>` only on `main` / tags, and only when GHCR login succeeds (`GITHUB_TOKEN`, `packages: write`). A skipped or failed login still builds; it does not push.

This is an image builder, not a claim the yard is production.

## What is still not here

- Authentication
- TLS / reverse-proxy recipe
- Health-checked multi-host deploy
- k8s / helm
- Migrating old Nightplot SQLite
- Hardware Done

Binding `0.0.0.0` in a container is so the published port works on a LAN. It is not a supported public-internet deploy. See [SECURITY.md](../SECURITY.md).

## Honest “run it on this machine” without Docker

1. Install ([install.md](install.md)).
2. `pnpm dev` or `pnpm dev:demo`.
3. Open `http://127.0.0.1:43180`.
4. Enroll a LAN WLED (or the fixture). Preview is not Apply. Fixture green is not Hardware Done.
