# Changelog

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
