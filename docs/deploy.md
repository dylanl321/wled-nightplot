# Deploy

Nightplot Configure is a LAN utility. This page is how to run the Docker image and compose file on a local machine or home network. There is no authentication and no TLS; do not publish the API on the public internet.

`pnpm dev` on loopback is still the usual operator path. See [install.md](install.md).

## What the image is

One image, three processes (`docker-entrypoint.sh`):

| Command | Process |
| --- | --- |
| `api` | Hono (`@nightplot/server`) on `NIGHTPLOT_API_HOST`:`NIGHTPLOT_API_PORT` |
| `web` | `next start` on `NIGHTPLOT_WEB_HOST`:`NIGHTPLOT_WEB_PORT` |
| `all` | both (default `CMD`) |

`docker-compose.yml` runs **two services** (web + api) from that image. Next rewrites `/api/*` and `/health` to `http://127.0.0.1:43181`. Web uses `network_mode: service:api` so that loopback is the API — not a bet on Docker bridge iptables. Browser fetches stay same-origin on the web port. The entrypoint starts `tsx` / `next` from workspace bins so a running container does not download pnpm. Ports are published on the **api** service (web has no own network).

`all` is the same loopback story in one container (`docker run -p 43180:43180 -p 43181:43181 …`).

A split onto a Docker *bridge* (two netns) needs a rebuild with `--build-arg NIGHTPLOT_API_URL=http://<api-service>:43181` and a working engine. That is not the default.

## Build

```bash
docker build -t nightplot-configure .
```

## Compose (bridge)

```bash
docker compose up --build
```

| Publish | What |
| --- | --- |
| `43180` | Web |
| `43181` | API |

Volume `lights-store` → `/data` (`NIGHTPLOT_STORE_PATH` lights, `NIGHTPLOT_LED_PRODUCTS_PATH` LED products, Activity beside the store, `backups/` for managed Nightplot backups).

Compose **does not** `env_file` [`.env.example`](../.env.example). That file is the loopback `pnpm dev` default. A loopback *bind* inside the container is not reachable from the published port — compose sets `NIGHTPLOT_API_HOST=0.0.0.0`. The web→API URL stays `http://127.0.0.1:43181` because the two services share a network namespace.

Pass-through only:

- `NIGHTPLOT_DISCOVERY_TARGETS` — typed Find extras (`host` or `host:port`)
- `NIGHTPLOT_CORS_ORIGINS` — extra API CORS origins (see below)

Open `http://127.0.0.1:43180`. Typed address enroll still works from the container (the API probes the LAN). Preview is temporary; Apply persists. A fixture report is a development stub, not a verified real strip. A sim enroll is software path only — not Hardware Done.

`docker compose config` must validate this file.

## Find (mDNS / SSDP) — honest limits

From a **bridge** network, multicast Find often sees nothing. That is expected. Typed address and `NIGHTPLOT_DISCOVERY_TARGETS` are the escape hatch.

The Find path that can see multicast on **Linux** is host networking:

```bash
docker compose -f docker-compose.host.yml up --build
```

That file is a standalone compose (one service, `all`, `network_mode: host`). It is not merged with the default file.

Docker Desktop / a VM is not a Linux LAN. Host networking there does not make mDNS/SSDP magically work. Type `host:port`.

## CORS

API defaults remain `http://127.0.0.1:43180` and `http://localhost:43180` (`apps/server/src/cors-origins.ts`). The browser path uses same-origin `/api` through Next, so CORS is not the usual compose path.

If something hits the API from another published web origin, set `NIGHTPLOT_CORS_ORIGINS` to a comma-separated list of http(s) origins. Defaults stay. `*` and wildcards are ignored (fail-closed). `pnpm dev` is unchanged when the variable is unset.

## One-container run

```bash
docker build -t nightplot-configure .
docker run --rm \
  -p 43180:43180 -p 43181:43181 \
  -v nightplot-lights:/data \
  -e NIGHTPLOT_STORE_PATH=/data/lights.json \
  -e NIGHTPLOT_LED_PRODUCTS_PATH=/data/led-products.json \
  nightplot-configure
```

Override the process: `docker run … nightplot-configure api`.

## GHCR workflow

[`.github/workflows/docker.yml`](../.github/workflows/docker.yml) builds the image.

- **Does not run on pull requests.**
- Triggers: `workflow_dispatch`, push to `main`, `v*` tags.
- How to run by hand: GitHub → Actions → Docker → Run workflow.
- Push to `ghcr.io/<owner>/<repo>` only on `main` / tags, and only when GHCR login succeeds (`GITHUB_TOKEN`, `packages: write`). A skipped or failed login still builds; it does not push.

The workflow packages a local/LAN image. It does not add authentication or TLS.

## If the web cannot reach the API

Restart the same way you started. The Lights recovery screen names both paths — it does not assume one run mode.

- Local: `pnpm dev` from the repo root so the API on 43181 is up with the web app.
- Compose: restart the compose project (`docker compose up --build`, or `docker compose -f docker-compose.host.yml up --build` on Linux host networking).
- One-container: restart the `docker run` process.

Do not run host `pnpm dev` against a container-only install.

## What this package does not include

- Authentication
- TLS / reverse-proxy recipe
- Health-checked multi-host deploy
- k8s / helm

Binding `0.0.0.0` in a container is so the published port works on a LAN. It is not a public-internet deploy. See [SECURITY.md](../SECURITY.md).

## Run it on this machine without Docker

1. Install ([install.md](install.md)).
2. `pnpm dev` or `pnpm dev:demo`.
3. Open `http://127.0.0.1:43180`.
4. Enroll a LAN WLED (or the fixture). Preview is temporary; Apply persists. Fixture green is a development stub, not a verified real strip.
