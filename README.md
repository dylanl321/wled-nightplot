# Nightplot Configure

Configure spine for home LED strips. Discover a controller, enroll it as a **Light**, describe **Elements** as ranges on the strip, preview live, then Apply. All Off has a home.

This is not a playback desk. It does not ship Yard, Tonight, Studio, Scene, or Show chrome.

R0 is a defensible skeleton: catalogs, a Quiet-utility Lights empty state, and the v2 prototype checked in as the visual source of truth. Discover / Preview / Apply / All Off are placeholders and do not talk to hardware.

## Run

Needs Node 20+ and [pnpm](https://pnpm.io).

```bash
pnpm install
pnpm dev
```

- App: [http://127.0.0.1:43180](http://127.0.0.1:43180)
- API: [http://127.0.0.1:43181](http://127.0.0.1:43181) (`/health`, `/api/catalogs`, `/api/lights`)

```bash
pnpm typecheck
pnpm test
```

## Layout

| Path | What |
| --- | --- |
| `apps/web` | Quiet-utility shell. Lights empty state. `StripBeads` is the only bead renderer. |
| `apps/server` | Catalogs and 501 placeholders for Discover / Preview / Apply / All Off. |
| `packages/shared` | Controller catalog (WLED first), strip catalog (WS281x first), discovery placeholders, Light / Element types. |
| `docs/ui/` | Nightplot Configure v2 prototype. See [docs/ui/README.md](docs/ui/README.md). |
| `docs/PLANE.md` | CONFIG tickets, REST-only Plane duties. |
| `AGENTS.md` | Naming, honesty, seams, slice rules. |

## Prototype

```bash
pnpm proto
```

Then open [http://127.0.0.1:43182/Nightplot%20Configure%20v2.dc.html](http://127.0.0.1:43182/Nightplot%20Configure%20v2.dc.html). Needs network for React (unpkg) and fonts.

## Publishing this draft

This Origin draft **is** Nightplot Configure. When you create the GitHub repository, name it **`nightplot-configure`** so CONFIG tickets, clone URLs, and this package name stay aligned.

Suggested remote after the GitHub repo exists:

```bash
git remote add github git@github.com:<you>/nightplot-configure.git
```

Plane project: Configure (`CONFIG`) in workspace `nightplot`. See `docs/PLANE.md`.
