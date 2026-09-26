# Changelog

## 0.7.0 — R6 Safe settings (CONFIG-7)

- Safe settings live on an enrolled Light (Inspect → Safe settings): display name, turn-on-at-boot, boot brightness, boot preset, default transition, global current limit.
- Read and write go through `/json/cfg`. The fingerprint is the set of those fields this firmware actually exposed. Unsupported firmware is refused closed — nothing is written.
- A field this parser does not understand is not on the writable form and is not sent. Fixture `/json/cfg` is software-green, not Hardware Done.

## 0.6.0 — R5 Manage a few + All Off (CONFIG-6)

- Lights remains the manage surface: name, address, online, on, ledCount, and live segment count (unknown when the Light is not answering).
- All Off lives on the rail (desktop) and thumb bar (phone), including empty and error screens. One press runs it when nothing is live.
- If Preview or Blink is live, confirm expands in place. Confirming cancels without restoring, then powers off each reachable enrolled Light.
- The result lists each Light by what it reported. Retry targets only the failed ids. Fixture readback is captioned — not Hardware Done.
- Delete Light is a check that runs (Elements, live sessions, controller state). The button fills n of m and stays locked until every check is complete. Unknown or partial impact is not safe; there is no “I understand” override.
- Safe settings stay parked for CONFIG-7 / R6.

## 0.5.0 — R4 Apply ranges + re-address (CONFIG-5)

- Edit ranges Apply writes declared Element ranges to the controller, then re-reads the snapshot. Success only when reported ranges match what was sent.
- A mismatch or failed reread stays on the failure UI (sent vs read back, Use controller’s / Apply again). No success toast.
- Preview stays temporary and distinct. Test live “Apply to {Element}” is still not a saved look.
- Re-address probes the new host first. Same-MAC continuity keeps the Light id; identity (name / MAC / ledCount / segments) comes from the fresh snapshot. The old address stays until that proves out.
- Successful Apply and re-address persist the enrolled address and last-good snapshot. Fixture software-green is not Hardware Done.
- All Off stays R5.

## 0.4.0 — R3 Test live (CONFIG-4)

- Test live sits on the same Light strip as Inspect / Edit ranges. Pick one Element, or the whole strip.
- Preview writes a temporary solid colour and brightness, then the beads follow `/json/live` readback. Ending restores the previous look. Preview is not Apply.
- Preview disabled shows a one-line reason (offline, no target, Blink already running).
- Blink Identify pulses, then restores on completion or error. Discover can Blink a candidate the same way.
- Proof ladder: Sent → Controller reports → a person confirms. The ladder names the live target, not a different selected chip. Fixture readback is captioned software-green — not Hardware Done.
- A second Preview on the same Light keeps the original restore snapshot.
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
