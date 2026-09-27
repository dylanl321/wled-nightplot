# Plane — Configure (`CONFIG`)

Nightplot Configure is tracked in Plane, not as a side conversation.

## Coordinates

| | |
| --- | --- |
| Deployment | `https://plane.home.dlewis.me` |
| API | `{PLANE_URL}/api/v1` → `https://plane.home.dlewis.me/api/v1` |
| Workspace | `nightplot` |
| Project | Configure (`CONFIG`) |
| Project id | `917032f0-60b2-4877-9496-2bb1f504131c` |

Auth: Cloud Agent secret `PLANE_API_KEY` as header `X-API-Key`.

**Never** `api.plane.so`. **Never** the Plane MCP. REST only.

## This series

CONFIG tickets are serial. R0 is skeleton only. Do not start the next slice in the same run.

Filed tickets through CONFIG-50. Do not invent unfiled numbers. Gaps and repo/ops are not the next R-slice; do not fold them into an R-ticket.

| Issue | Title (as filed) |
| --- | --- |
| CONFIG-1 | R0 — Skeleton + catalogs + UI template import |
| CONFIG-2 | R1 — Discover + connect Lights |
| CONFIG-3 | R2 — Snapshot + visualize ranges / Elements |
| CONFIG-4 | R3 — Live test (Preview / Blink); stub /json/live |
| CONFIG-5 | R4 — Setup Apply (ranges); reconnect from fresh snapshot |
| CONFIG-6 | R5 — Manage a few + All Off |
| CONFIG-7 | R6 — Safe settings (optional) |

Gaps (not the next R-slice; do not fold into an R-ticket):

| Issue | Title (as filed) |
| --- | --- |
| CONFIG-8 | Doc gap — prototype v1 link + support.js rebuild path |
| CONFIG-9 | SSDP/mDNS discovery hardcodes port 80 |
| CONFIG-10 | GET /api/lights re-probes every enrolled Light |
| CONFIG-11 | Metal name lag after Safe settings rename (/json/info vs /json/cfg) |
| CONFIG-12 | SSDP ST filter may miss WLED boxes |
| CONFIG-13 | mDNS SRV-only .local may not resolve in Node |
| CONFIG-14 | Espalexa SSDP LOCATION may advertise :80 when HTTP is not |
| CONFIG-15 | Dead-Light probe ~6s — probeWled waits /json then /json/info |
| CONFIG-16 | Inspect loads list + detail; detail also refreshOne + /json/live |
| CONFIG-17 | Mutating routes still refreshOne every Light they touch |
| CONFIG-18 | GET Inspect still writes store; POST refresh is explicit probe |
| CONFIG-19 | Cached Online rows: Online · on with grey beads until Inspect |
| CONFIG-21 | Find M-SEARCH still only wled:1 — Basic:1 Hue-shaped may miss until CONFIG-12 base |
| CONFIG-22 | v2 Discover canvas missing Espalexa port-warning treatment |
| CONFIG-23 | apps/web has no component tests |
| CONFIG-24 | Find "nothing new" notice when only new rows are rejected Espalexa |
| CONFIG-25 | displayHost hides :80 while Espalexa warning talks about :80 |
| CONFIG-27 | Find probes collected hosts sequentially |
| CONFIG-28 | Probe-failed copy always says "in 3 s" even on instant refuse |
| CONFIG-29 | Hanging /json/state after successful /json/info can still add a wait |
| CONFIG-30 | Preview overwrites reported ranges; client .map crash |
| CONFIG-31 | v2 Lights tray (2a) missing Espalexa portWarning example |
| CONFIG-32 | v2 Discover canvas not-WLED row still shows default :80 |
| CONFIG-33 | v2 Discover canvas not-WLED row still shows default :80 |
| CONFIG-35 | Extract Inspect Refresh probe test from full light-detail tree |
| CONFIG-36 | All Off still hardcodes "no answer … in 3 s" |
| CONFIG-37 | Info-only snapshot treats missing on as Online · off |
| CONFIG-38 | error.tsx still tells ServerDown for unrelated client throws |
| CONFIG-39 | discover/blink still puts match counts on reported |
| CONFIG-40 | First-time WLED strip provision — length / GPIO / type via cfg |
| CONFIG-41 | Strip presets — 3 named defaults (type + length + GPIO) |
| CONFIG-43 | Declared Elements not rewritten when strip length changes |
| CONFIG-49 | Discover Promise.all couples Find failure to ServerDown |

Repo / ops (not the next R-slice; do not fold into an R-ticket):

| Issue | Title (as filed) |
| --- | --- |
| CONFIG-20 | North Star / MVP sanity check vs shipped Configure |
| CONFIG-26 | Real-strip Hardware Done — validate configure spine on live WLED |
| CONFIG-34 | docs/PLANE.md catch-up — series table + Publishing name |
| CONFIG-42 | Yard deploy — human review checklist (single list) |
| CONFIG-44 | Production docs + governance scaffold (README hub, CONTRIBUTING, CONSTITUTION, SECURITY, LICENSE, docs/*) |
| CONFIG-45 | Docker image builder + compose + deploy docs wiring |
| CONFIG-46 | ServerDown recovery copy assumes pnpm dev (wrong under compose/docker) |
| CONFIG-47 | Fix ServerDown Lights copy for compose/docker (not only pnpm dev) |
| CONFIG-48 | ServerDown copy still says run pnpm dev under compose |
| CONFIG-50 | Rewrite public docs voice — standalone product, not intake chat |

| Issue | id |
| --- | --- |
| CONFIG-1 | `298cb9ff-bacb-4c20-83c6-54d5ba8f5747` |
| CONFIG-2 | `70d76b1b-ba37-4181-8e90-138cdddb3b57` |
| CONFIG-3 | `d2a9a037-4b96-4f86-b6b1-3141a0a9bb8f` |
| CONFIG-4 | `59cd7b64-86a6-49e6-bafe-400b6cc3037f` |
| CONFIG-5 | `94623fba-a991-4240-a0dc-29dae5e2da7b` |
| CONFIG-6 | `8425ad37-8a35-42d1-81c8-5f7306d833bb` |
| CONFIG-7 | `2c54b44a-5342-4819-9217-ce23177eba4f` |
| CONFIG-8 | `6bb9cba3-f49d-48e3-90e5-bbc71a343836` |
| CONFIG-9 | `8dc7e136-2149-4dc1-9940-fd01a9202350` |
| CONFIG-10 | `a8bb769e-4732-4f28-90c1-12a0b5bb318d` |
| CONFIG-11 | `3ab014bd-a807-4cf6-8edb-1dd9a75950c1` |
| CONFIG-12 | `114c5135-9689-4b08-b80f-7cdfae017695` |
| CONFIG-13 | `6f028d65-c85e-4649-8a61-595c2b32ea31` |
| CONFIG-14 | `20ad519c-5b67-4c7d-b300-663358f51020` |
| CONFIG-15 | `5b21a786-0419-4e6d-b203-ae5ce58d81d0` |
| CONFIG-16 | `1e777968-36f3-4343-9fdb-468841b67ea8` |
| CONFIG-17 | `a9a2a78a-653c-457c-85a8-f8a579b2c2a6` |
| CONFIG-18 | `e61abe96-6391-46b7-8193-dd91bf729ab9` |
| CONFIG-19 | `ade12801-fcb5-4dbf-afd2-84e39103f980` |
| CONFIG-20 | `317bb8a3-973d-47b8-9626-e3cd370cb5be` |
| CONFIG-21 | `b3e5bf83-7145-4437-93c0-0a8785a4fbd7` |
| CONFIG-22 | `26d0dec1-1c1a-4855-8eeb-b5d53ea8be4f` |
| CONFIG-23 | `dcc047d0-317d-4e8c-9059-bdbf00cf619b` |
| CONFIG-24 | `8ea3e997-594b-4959-970b-34b69e81eb0d` |
| CONFIG-25 | `4e68e08f-8e08-4de3-a4da-44891b04013b` |
| CONFIG-26 | `36e0e7b1-1aaf-45d8-9b78-ba290f7dcda4` |
| CONFIG-27 | `2347689b-fc7e-486b-bc6b-26bbbeb632ae` |
| CONFIG-28 | `d0b3b574-10e4-4b0b-b760-4382b5ad472c` |
| CONFIG-29 | `512dbe3c-f5a1-4d49-bf17-dbaae2ef10e5` |
| CONFIG-30 | `b55d3982-dc07-42f1-b2f0-727fb80dc187` |
| CONFIG-31 | `6afa3461-c102-459f-8b50-691719f8ca9a` |
| CONFIG-32 | `81e0d2f9-015f-493f-ad9e-9ef7b8d9d3b1` |
| CONFIG-33 | `0af70f37-1d82-4fb0-bbb7-276c0238254f` |
| CONFIG-34 | `4e8b67c4-2213-417b-ad9f-241f75d750d2` |
| CONFIG-35 | `6a969c45-c83e-4190-818e-eef03ee27890` |
| CONFIG-36 | `6e88764b-80cf-49b5-bd9b-daa37a94e629` |
| CONFIG-37 | `4b347d15-54fa-4e25-a208-87c55f4dfed7` |
| CONFIG-38 | `87f11818-84fb-4b84-9c3d-e92a1392c659` |
| CONFIG-39 | `c8c426b3-8b8b-45a2-aa13-1c5353503e04` |
| CONFIG-40 | `33b603a5-f883-476c-8a4b-68720c18a580` |
| CONFIG-41 | `63882929-398d-43a7-ac45-1d9f25109134` |
| CONFIG-42 | `0f080c7c-d82f-4d99-b3d6-6c380ec5fa35` |
| CONFIG-43 | `b8004089-34cb-4a0f-be4f-926d2c0b80d2` |
| CONFIG-44 | `60204c88-2520-4616-990e-fd48c8939ca5` |
| CONFIG-45 | `b0e38d0d-241a-4371-8064-f42873597ba5` |
| CONFIG-46 | `6ebc38e7-0112-4b19-b022-5ca4b3f49303` |
| CONFIG-47 | `9b3c7e69-db9c-4965-9036-b3d5380f22ee` |
| CONFIG-48 | `5137414d-48f0-4397-99a3-198225bcb263` |
| CONFIG-49 | `f6f055b4-79c2-4b1f-bd11-f880233fd1ca` |
| CONFIG-50 | `b2bb41fd-beea-4771-a6f8-df112be8cf73` |

## States

| State | id |
| --- | --- |
| In Progress | `35f29105-4f44-44b7-893c-db546c54bd7e` |
| Done | `b48d3344-e801-4e20-b51d-df3519245fbb` |

## Duties on a CONFIG ticket

1. **Before the first code edit:** `PATCH` the issue to In Progress and post a start comment that names the slice and what is out of scope.
2. **During the work:** comment on major milestones and blockers. Keep comments factual.
3. **Adjacent findings:** if you notice other bugs, gaps, or risks, do **not** fold them into the current slice. Post a Plane comment with separate investigation stubs for intake.
4. **On clear completion:** `PATCH` to Done and post a completion comment: what landed, how to run it, and any naming/publishing notes.

## REST shapes

```http
PATCH /api/v1/workspaces/nightplot/projects/917032f0-60b2-4877-9496-2bb1f504131c/issues/{issue_id}/
X-API-Key: $PLANE_API_KEY
Content-Type: application/json

{"state":"<state-id>"}
```

```http
POST /api/v1/workspaces/nightplot/projects/917032f0-60b2-4877-9496-2bb1f504131c/issues/{issue_id}/comments/
X-API-Key: $PLANE_API_KEY
Content-Type: application/json

{"comment_html":"<p>…</p>"}
```

`PLANE_URL` may include a trailing slash. Strip it before appending `/api/v1`.

## Publishing name

GitHub home is [`dylanl321/wled-nightplot`](https://github.com/dylanl321/wled-nightplot) on `main`. The package name is `nightplot-configure`. Plane project Configure (`CONFIG`) stays Nightplot Configure. The GitHub repo name and the package name are intentionally different.
