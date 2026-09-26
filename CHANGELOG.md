# Changelog

## 0.4.0 — R3 Test live (CONFIG-4)

- Test live sits on the same Light strip as Inspect / Edit ranges. Pick one Element, or the whole strip.
- Preview writes a temporary solid colour and brightness, then the beads follow `/json/live` readback. Ending restores the previous look. Preview is not Apply.
- Preview disabled shows a one-line reason (offline, no target, Blink already running).
- Blink Identify pulses, then restores on completion or error. Discover can Blink a candidate the same way.
- Proof ladder: Sent → Controller reports → a person confirms. Fixture readback is captioned software-green — not Hardware Done.
- Apply stays R4 (501 / disabled). All Off stays R5; the UI states that a live Preview would end without restoring.

## 0.3.0 — R2 Snapshot + Elements (CONFIG-3)

- Light Inspect shows identity and a linear `StripBeads` rail of `ledCount` (glowing beads from the v2 template).
- Elements are contiguous ranges: label, start inclusive, stop exclusive, length derived. Inspect / Edit ranges are modes on one strip.
- Declared brackets sit above the beads; reported WLED segments sit below. Coverage drift is labeled on the dual rails.
- Overlap, invert, and over-ledCount are editor errors: they paint red on the beads and block save of an invalid draft with a reason.
- Unreachable Lights stay grey with last-seen. No last colour and no last reported range are invented.
- Declared Elements persist with the Light store. Save declared writes Nightplot only. Apply to the controller is omitted as a working action (disabled, reason R4).
- Preview / Blink / All Off / Delete stay placeholders.

## 0.2.0 — R1 Discover + connect (CONFIG-2)

- Address probe and LAN find (mDNS / SSDP / optional `NIGHTPLOT_DISCOVERY_TARGETS`) are live. Public and other disallowed addresses are refused before any HTTP.
- Confirmed WLED candidates can be added. Rejects stay listed with a plain reason (`disallowed-address`, `probe-failed`, `not-wled`, `already-added`).
- Connect fails closed if a snapshot cannot be read. Duplicate host:port is refused. Enrolled Lights persist in `data/lights.json`.
- Lights home shows the rack plus an unenrolled tray. Unreachable enrolled Lights use grey beads and last-seen — never a stored last colour.
- Preview / Apply / All Off stay placeholders.
- Local WLED-shaped fixture: `pnpm fixture` on `127.0.0.1:48210`. Demo boot: `pnpm dev:demo`.

## 0.1.0 — R0 skeleton (CONFIG-1)

- TypeScript monorepo: `apps/web`, `apps/server`, `packages/shared`.
- Controller catalog registers WLED first. Strip catalog registers WS281x first. Discovery lists mDNS, SSDP, and address probe as placeholders. None of those members are wired; registered is not Hardware Done.
- Quiet-utility shell hosts the Lights empty state (v2 language). `StripBeads` draws the rail. All Off / Find Lights / Type an address are placeholders and send nothing to a strip.
- v2 design canvas committed at `docs/ui/` with open instructions.
- `AGENTS.md` and `docs/PLANE.md` record CONFIG ticket duties and naming.
- Dev boot on 43180 / 43181, plus `pnpm typecheck` and `pnpm test` smoke.
