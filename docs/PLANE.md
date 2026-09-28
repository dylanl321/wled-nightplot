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

This list was refreshed from Plane (workspace `nightplot`, project Configure) on 2026-09-28. **131 issues are filed.** Sequence ids run 1–133. CONFIG-129 and CONFIG-130 are not filed. Do not invent unfiled numbers. Gaps and repo/ops are not the next R-slice; do not fold them into an R-ticket. Keeping these tables current on file is CONFIG-51.

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

### Discovery, Inspect, All Off

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
| CONFIG-16 | Inspect Promise.all couples list+detail; detail miss still ServerDowns |
| CONFIG-17 | Mutating routes still refreshOne every Light they touch |
| CONFIG-18 | GET Inspect still writes store; POST refresh is explicit probe |
| CONFIG-19 | Cached Online rows: Online · on with grey beads until Inspect |
| CONFIG-21 | Find M-SEARCH still only wled:1 — Basic:1 Hue-shaped may miss until CONFIG-12 base |
| CONFIG-22 | v2 Discover canvas missing Espalexa port-warning treatment |
| CONFIG-23 | apps/web has no component tests |
| CONFIG-24 | Find “nothing new” notice when only new rows are rejected Espalexa |
| CONFIG-25 | displayHost hides :80 while Espalexa warning talks about :80 |
| CONFIG-27 | Find probes collected hosts sequentially |
| CONFIG-28 | Probe-failed copy always says “in 3 s” even on instant refuse |
| CONFIG-29 | Hanging /json/state after successful /json/info can still add a wait |
| CONFIG-31 | v2 Lights tray (2a) missing Espalexa portWarning example |
| CONFIG-32 | v2 Discover canvas not-WLED row still shows default :80 |
| CONFIG-33 | v2 Discover canvas not-WLED row still shows default :80 |
| CONFIG-35 | Extract Inspect Refresh probe test from full light-detail tree |
| CONFIG-36 | All Off still hardcodes “no answer … in 3 s” |
| CONFIG-37 | Info-only snapshot treats missing on as Online · off |
| CONFIG-38 | error.tsx still tells ServerDown for unrelated client throws |
| CONFIG-39 | discover/blink still puts match counts on reported |
| CONFIG-49 | Discover Promise.all couples Find failure to ServerDown |
| CONFIG-66 | Inspect Promise.all couples detail miss to ServerDown |
| CONFIG-67 | Delete unknown copy says “Couldn’t read it in time” without measuring |
| CONFIG-68 | All Off still probes enrolled Lights one-by-one |
| CONFIG-69 | Re-land listLights cache/last-seen only (CONFIG-10 missing on GitHub main) |

### Strip and LED products

| Issue | Title (as filed) |
| --- | --- |
| CONFIG-40 | First-time WLED strip provision — length / GPIO / type via cfg |
| CONFIG-41 | Strip presets — 3 named defaults (type + length + GPIO) |
| CONFIG-43 | Declared Elements not rewritten when strip length changes |
| CONFIG-52 | LED product catalog — model + JSON store + list/create API |
| CONFIG-53 | Strip: attach LED product to Light + fill provision draft |
| CONFIG-54 | Expand strip drivers + provision maps (RGBW / next IC) |
| CONFIG-55 | Bead / Inspect honesty for multi-channel LED products (RGBW) |
| CONFIG-56 | Strip attach UX — identity vs field-matching “current” chip |
| CONFIG-57 | RGBW extras — UCS8904 / TM1814 refuse-closed maps |
| CONFIG-58 | RGBWW map — WS2805 / SM16825 / FW1906 refuse-closed |
| CONFIG-59 | SK6812 convert authors GRBW (order 0) only |
| CONFIG-60 | Seed stripKind from Inspect cfg GET (never from snapshot rgbw) |
| CONFIG-61 | Enroll / Inspect do not read /json/cfg — stripKind stays default ws281x |
| CONFIG-62 | Hydrate stripKind from /json/cfg on enroll + Inspect (not leds.rgbw) |
| CONFIG-63 | RGBWW / white-channel live UI (slider + Preview W) — deferred |
| CONFIG-64 | Strip UI — show preserved colour order after same-type Apply |
| CONFIG-65 | Product: colour-order picker + extra mapping rows |
| CONFIG-113 | Catalog manage UI + shared recipe vs per-Light override clarity |
| CONFIG-114 | Modular strip-assist: length helper (segment helper can plug in later) |
| CONFIG-115 | Docs — shared LED/IC catalog vs per-Light specifics + strip-assist plugins |
| CONFIG-118 | Catalog delete — refuse while Lights still attach recipe |
| CONFIG-119 | Strip provision: hide load-path refuse/notice double-print |

### Apply, Preview, Edit ranges, Safe settings

| Issue | Title (as filed) |
| --- | --- |
| CONFIG-30 | Preview overwrites reported ranges; client .map crash |
| CONFIG-71 | Info-only live reports segmentCount 0 instead of segments unknown |
| CONFIG-72 | Preview restore treats info-only on null as on (snapshot.on ?? true) |
| CONFIG-73 | Preview restore invents brightness/colour defaults on info-only snapshot |
| CONFIG-74 | Preview start still writes on:true when power is unknown |
| CONFIG-75 | Unknown segments still feed empty rails into drift compare |
| CONFIG-76 | Apply invents #ffa000 when colour is unknown |
| CONFIG-77 | Off snapshots drop segmentColor so restore cannot restore pre-Preview colour |
| CONFIG-78 | Apply reread coalesces unknown seg to empty before applyOutcome |
| CONFIG-79 | Edit ranges row still says matches when segments are unknown |
| CONFIG-80 | Edit ranges selected-Element chip says seg when compare refused |
| CONFIG-81 | ApplyFailed UI says Apply didn’t stick when reread segments are unknown |
| CONFIG-82 | Preview restore still maps snapshot.segments ?? [] |
| CONFIG-83 | Apply write uses segments?.length ?? 0 for leftover-segment clears |
| CONFIG-84 | Strip Apply failure title always says Apply didn’t stick |
| CONFIG-85 | ApplyFailed Use controller’s is a silent no-op when reread is unknown |
| CONFIG-86 | Apply write-failed and reread-failed still send apply.read as empty list |
| CONFIG-87 | selectedKind chip says overlap for invert/past-strip |
| CONFIG-88 | Edit ranges selected-Element chip says overlap for invert / past-strip |
| CONFIG-89 | provision refuse 422 omits provisionWrite (Strip notice-only) |
| CONFIG-90 | ApplyFailed caption says controller reported ranges when unread |
| CONFIG-92 | Edit ranges bead legend hardcodes red key as overlap |
| CONFIG-93 | safe refuse 422 omits safeWrite (Strip notice-only) |
| CONFIG-95 | safe refuse 422 omits safeWrite (Strip notice-only) |
| CONFIG-96 | Provision parse runs twice on one cfg (readProvision + buildProvisionWrite) |
| CONFIG-97 | Apply write/reread-failed hardcodes source controller on fixture |
| CONFIG-98 | Known empty apply.read [] caption still says these ranges |
| CONFIG-99 | Safe/provision refuse captions still say Read from /json/cfg |
| CONFIG-100 | Apply write/reread-failed hardcodes applyUnreadFailed source controller |
| CONFIG-101 | Known empty Apply reread caption still says these ranges |
| CONFIG-102 | Safe/provision refuse captions still say Read from /json/cfg |
| CONFIG-103 | Edit ranges bead legend always shows dashed drift key |
| CONFIG-104 | over-ledCount misses inverted range whose start is past strip |
| CONFIG-105 | Safe settings refuse still double-prints notice + no Sent/Read panel |
| CONFIG-106 | buildSafeWrite dual refuse after safeRefuseReason (same-fingerprint class) |
| CONFIG-107 | ApplyFailed unknownReread still keys message string equality |
| CONFIG-108 | Empty-read apply caption still says until you see them on the strip |
| CONFIG-109 | Edit-ranges kind chip/legend still use issues[0] only on dual invert+past-strip |
| CONFIG-110 | Non-integer start/stop skip over-ledCount after whole-index invert |
| CONFIG-111 | PATCH elements 422 error is first code only (misses past strip on dual) |
| CONFIG-116 | v2 Edit-ranges canvas always paints dashed drift + overlap keys |
| CONFIG-117 | Safe settings: hide load-path refuse/notice double-print |
| CONFIG-120 | v2 phone #2d Edit-ranges has no bead legend (drift-without-overlap unframed) |
| CONFIG-121 | v2 Edit-ranges has no invert / past-strip canvas frames for legend errorLabel |
| CONFIG-122 | v2 #2d selected-Element kind chip still says seg 1 |
| CONFIG-123 | Invert declared rails draw no bead bracket (pieces requires start < stop) |
| CONFIG-131 | Apply refuse waits for first Preview hop session after Show on the real strip |

### Live locate

| Issue | Title (as filed) |
| --- | --- |
| CONFIG-124 | Live locate client coalesce — throttle Preview hops / skip no-op / stop bead chase |
| CONFIG-125 | Preview session update path — no re-snapshot / optional skip live reread on locate hops |
| CONFIG-126 | WLED locate write shape — cut segment churn on Preview frames |
| CONFIG-127 | Hold-mode locate — keep Elements lit without per-mousemove segment punch |
| CONFIG-128 | Real-strip bench — live locate Cursor/Hold stability after coalesce stack |

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
| CONFIG-51 | Intake: keep docs/PLANE.md series + issue-id tables current on file |
| CONFIG-70 | Fixture box MAC hardcoded — two local stubs share one address |
| CONFIG-91 | spike: headless WLED sim e2e lane (≠ Hardware Done) |
| CONFIG-94 | spike: provision dual-parse of same cfg can disagree |
| CONFIG-112 | pnpm typecheck fails on main Find discovery collect/interfaces |
| CONFIG-132 | Web test setup unstubs fetch before RTL cleanup — unmount POST can reject |
| CONFIG-133 | docs/PLANE.md series table is stale past early CONFIG numbers |

## Issue ids

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
| CONFIG-51 | `1058045b-2e8d-4e18-8a48-75547d3246da` |
| CONFIG-52 | `4ef696a0-77d4-4442-8018-2b5f8d71d68d` |
| CONFIG-53 | `e86daa83-0f56-4ca2-b9e5-4ee932ba9283` |
| CONFIG-54 | `2dbaa9cc-ce46-4975-a73b-9a4f4e1b1910` |
| CONFIG-55 | `5063c2c9-989c-433b-862f-9dbf5c40641f` |
| CONFIG-56 | `4706b04d-3167-4ea1-98c9-738ef6aac22d` |
| CONFIG-57 | `d6e6a275-662c-4ade-8e13-68fc75d9086c` |
| CONFIG-58 | `dcb8308b-dd01-457b-a82b-a3b52da3e770` |
| CONFIG-59 | `5e4b9c55-e801-4428-9d48-7966b8043d1f` |
| CONFIG-60 | `8d70f167-f12b-46a9-abc8-b0c53240ca15` |
| CONFIG-61 | `2bf03266-9684-4fe9-b97a-8c0161fa1cf9` |
| CONFIG-62 | `6eb928a3-6c18-475f-851e-d1c4ba99c7c5` |
| CONFIG-63 | `f890b38c-f5c6-4275-bd62-d1eb2af3f297` |
| CONFIG-64 | `407e153b-b224-4888-988c-a80aadc72b84` |
| CONFIG-65 | `840426e6-feec-46a1-8cd5-48a0b417378f` |
| CONFIG-66 | `0d352b3a-0ffb-4e06-94d3-b8b28fcef4fd` |
| CONFIG-67 | `5d2b36c7-ad92-4d58-a020-c4cf434cd7e4` |
| CONFIG-68 | `55d7d210-7171-4ffb-8436-6c3848ea3b1d` |
| CONFIG-69 | `a60c81fb-2ff2-4444-9eef-810aa0626b50` |
| CONFIG-70 | `80d02b3b-a9df-4f12-a202-7d7f36424b80` |
| CONFIG-71 | `08603488-8311-4233-96f0-8dd6d4c7c536` |
| CONFIG-72 | `430f198f-6981-4f0c-b291-1489b9d9047d` |
| CONFIG-73 | `c37965b1-be00-4fc4-961a-ba2764c79473` |
| CONFIG-74 | `db1966cb-3997-4cd8-aa02-c529a973d2cd` |
| CONFIG-75 | `47f60a7d-00e1-4196-b615-27ab9a0770e7` |
| CONFIG-76 | `74d6b87a-e00b-4adc-a79f-e61b9c9fd353` |
| CONFIG-77 | `cd13469f-9aad-44c5-b778-b17d468d491f` |
| CONFIG-78 | `51bff27c-c84a-4749-81d1-70cf1839dc66` |
| CONFIG-79 | `5c677057-1680-4082-af5c-05d3af6c6b4c` |
| CONFIG-80 | `82b0a642-2b88-4f44-8c92-72094c201b46` |
| CONFIG-81 | `ee5c9903-bed4-4874-97c4-85dbb827573d` |
| CONFIG-82 | `823f9bc8-031d-41e8-aa6b-3d05f65a8a8c` |
| CONFIG-83 | `16870164-25e9-477e-acb6-9f2ff1f5186f` |
| CONFIG-84 | `00e7187d-9935-469c-8d13-c884c6bda661` |
| CONFIG-85 | `af884036-7626-4dab-89d6-e7bf7572a16b` |
| CONFIG-86 | `c718ff28-61ad-4516-8b41-31d93797483b` |
| CONFIG-87 | `a696a650-1eac-48ab-a132-ddf769d98543` |
| CONFIG-88 | `550fff5f-0c4d-4585-8bdc-071854ca5b02` |
| CONFIG-89 | `5ffd1b5a-5694-44a0-b2e7-c56434c66311` |
| CONFIG-90 | `087c6c7b-bed8-4453-8554-dba11e1b10c7` |
| CONFIG-91 | `ffa2a3f4-bfb6-48c6-b6cc-c6fcd9aee9e0` |
| CONFIG-92 | `7b379961-fe21-4e5f-9bb5-b2252e3f6b7a` |
| CONFIG-93 | `c72636eb-7f45-4361-ad90-344c50c59b4a` |
| CONFIG-94 | `f2b6cbb7-661a-4ed6-bc19-fe3a202daa8a` |
| CONFIG-95 | `5743bb06-db9c-47ff-9bb8-367138809c5d` |
| CONFIG-96 | `a7966dc1-f512-49e8-b1cf-4ccc01aa8f75` |
| CONFIG-97 | `c855b270-d3cb-425f-b5ff-2ff297a2e9b6` |
| CONFIG-98 | `6449ecdb-5fbe-4bee-a718-dfb6f5fae622` |
| CONFIG-99 | `0f8c3bc6-cbd7-4a2a-b8da-d922f13c6689` |
| CONFIG-100 | `33468049-40e9-4d49-8ae7-a632747dc6c5` |
| CONFIG-101 | `0a9ec5bd-72b3-484b-8079-2f9990b9b839` |
| CONFIG-102 | `b1bf0bec-512e-4bb4-a346-b65ff6b73aa5` |
| CONFIG-103 | `559bd44f-eb21-4932-b29d-7350d953e27a` |
| CONFIG-104 | `3fb7585a-c743-4235-92a3-92f52a43e8c5` |
| CONFIG-105 | `80b2a701-574d-4e50-bc40-5ae119c4b7da` |
| CONFIG-106 | `a321287b-388a-4096-8d56-4fa9d53280b6` |
| CONFIG-107 | `1cae523e-9683-43cd-a804-4ce8b06293a2` |
| CONFIG-108 | `f1263786-7b7d-4eb7-b02f-04b062ac0b1a` |
| CONFIG-109 | `5de0d48f-5cbf-4202-936f-29685df297de` |
| CONFIG-110 | `54a56a8c-105c-4ab9-be43-ed5fd0d2748c` |
| CONFIG-111 | `4db41772-6968-464c-a6ce-0825975fa359` |
| CONFIG-112 | `8f055c24-a630-4969-ae25-10ce27b0ccbb` |
| CONFIG-113 | `5aa6f8a8-cee2-4dd4-b916-bfc8c233c094` |
| CONFIG-114 | `a99b482f-1a31-4208-a788-72066b499a42` |
| CONFIG-115 | `e6d348a0-e60d-4b05-ae30-9cf3e81a13fc` |
| CONFIG-116 | `fb2f09ab-4ac8-4656-8fc9-133218876036` |
| CONFIG-117 | `d90eb71d-9bdf-4680-8bd3-8db261e0fb19` |
| CONFIG-118 | `0e9b05ce-94cb-4b82-8271-00271fcee493` |
| CONFIG-119 | `4dd0439d-b3de-4b44-8f10-34f38feae628` |
| CONFIG-120 | `8336e415-e5fe-417d-bbf0-c566e604423d` |
| CONFIG-121 | `522d2d70-787c-471c-806e-46387cac08af` |
| CONFIG-122 | `b7bf1c02-4c57-4c00-84cf-326fbbb28f70` |
| CONFIG-123 | `26eeec05-c665-42e3-a075-7286ef6d41f8` |
| CONFIG-124 | `9819771d-b73c-44df-90e9-bff794b87e8f` |
| CONFIG-125 | `bd5f6912-20e5-4d59-b09b-08eacb16bcdd` |
| CONFIG-126 | `b76afd6c-6d6b-4942-babf-5c129a8e2c3b` |
| CONFIG-127 | `110cc377-5b71-45b0-b6bd-3b422e7cf449` |
| CONFIG-128 | `50a32527-9403-4427-bf36-53743573ea3a` |
| CONFIG-131 | `1b45b419-94d3-4d93-96aa-d7281d627f55` |
| CONFIG-132 | `67b6e901-7aa7-4d9c-9525-93b8ebd880f8` |
| CONFIG-133 | `cfb0dd74-7a9d-4c87-a7e1-6521565cd4d9` |

## States

| State | id |
| --- | --- |
| Backlog | `0584bbf2-887b-4534-81de-a8d6f4409ca0` |
| Todo | `da64093a-3a6c-47ad-8cdf-ac3034a6d802` |
| In Progress | `35f29105-4f44-44b7-893c-db546c54bd7e` |
| Done | `b48d3344-e801-4e20-b51d-df3519245fbb` |
| Cancelled | `948d4078-829a-4fb7-966e-fdc4486e259b` |

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
