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

| Issue | Title (as filed) |
| --- | --- |
| CONFIG-1 | R0 — Skeleton + catalogs + UI template import |
| CONFIG-2 | R1 — Discover + connect Lights |
| CONFIG-3 | R2 — Snapshot + visualize ranges / Elements |

Issue id for CONFIG-1: `298cb9ff-bacb-4c20-83c6-54d5ba8f5747`.  
Issue id for CONFIG-2: `70d76b1b-ba37-4181-8e90-138cdddb3b57`.  
Issue id for CONFIG-3: `d2a9a037-4b96-4f86-b6b1-3141a0a9bb8f`.

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

This Origin draft is Nightplot Configure. When it gets a GitHub home, use **`nightplot-configure`** so CONFIG tickets, clone URLs, and the `nightplot-configure` package name stay aligned.
