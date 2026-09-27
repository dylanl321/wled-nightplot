# Deploy

High-level only. Nightplot Configure is a LAN utility bound to loopback. It is **not** production-ready.

## What exists today

| Piece | How it runs |
| --- | --- |
| Web | Next.js (`apps/web`). `pnpm --filter @nightplot/web dev` / `build` / `start` on `127.0.0.1:43180` |
| API | Hono + `@hono/node-server` (`apps/server`). `pnpm --filter @nightplot/server dev` / `start` on `127.0.0.1:43181` |
| Shared | `@nightplot/shared` workspace package. Types and catalogs. Not a separate process |
| Store | `FileLightsStore` → `data/lights.json` (override `NIGHTPLOT_STORE_PATH`) |
| Fixture | `pnpm fixture` on `127.0.0.1:48210` — stub, not Hardware Done |

`pnpm dev` is the supported operator path. `next start` and `tsx src/index.ts` exist; there is no process supervisor, TLS, reverse-proxy recipe, or auth in this repo.

The web app rewrites `/api/*` and `/health` to `NIGHTPLOT_API_URL` (`apps/web/next.config.ts`). CORS on the API allows only the local web origin (`apps/server/src/app.ts`).

## What is not here

**Docker, compose, and GHCR are CONFIG-45.** They are not in this tree. Do not treat a missing Dockerfile as an implied image.

Also not here:

- Authentication
- A public bind
- Health-checked multi-host deploy
- Migrating old Nightplot SQLite

Binding the API on a public interface is not a supported deploy. See [SECURITY.md](../SECURITY.md).

## Honest “run it on this machine”

1. Install ([install.md](install.md)).
2. `pnpm dev` or `pnpm dev:demo`.
3. Open `http://127.0.0.1:43180`.
4. Enroll a LAN WLED (or the fixture). Preview is not Apply. Fixture green is not Hardware Done.

When CONFIG-45 lands, this page should point at those files. Until then: localhost.
