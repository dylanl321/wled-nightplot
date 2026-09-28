# Refinement intake — September 28, 2026

The site review identified the following follow-up work. Plane tracking was
explicitly waived for this implementation run; these are intake notes, not
newly assigned CONFIG numbers or completed tickets. Deliver one slice per run.

## Landed in the first slice

Preview locate follows continuous movement on a fixed 50 ms send interval with
one request in flight and one replaceable pending position. Failed or uncertain
responses pause sending until explicit retry. A local stop/restart waits for
the current request and End Preview. Failed end/restoration is surfaced.
Tests cover timing, failure recovery, lifecycle ordering, and Apply gating.
No real-strip timing or hardware completion is claimed.

## Remaining, in dependency order

1. **Controller Preview correctness.** Serialize writes per Light; add ownership,
   frame ordering, abandonment leases, and All Off cancellation barriers.
   Capture complete restorable segment state, including IDs, colors and white
   channels, effects, grouping, orientation, and freeze state. Remove duplicate
   startup reads and remember unsupported live-read endpoints. Client request
   aborts do not cancel work already accepted by the server.
2. **Preview transport and Hold.** Use capability-checked individual-LED writes
   so movement does not rebuild segment ranges. Keep Elements lit while
   highlighting the cursor inside Elements as well as gaps. Return compact
   acknowledgements and bounded timing diagnostics. Keep one controller/strip
   architecture, and validate restoration before changing transport.
3. **Direct COB Settings and driver identity.** Add per-Light appearance and
   optional section length/pitch, inherited from an attached LED product unless
   overridden. Save description independently of hardware Apply. The reviewed
   Light `b9c294d1-825b-4ab5-8e13-c75d904984e1` should be described as COB;
   section length is not yet known. Its controller reported native type 28
   (FW1906 in matching WLED 0.15.1 source), 60 addressable positions, and a 501
   response from `/json/live`. Identify reported hardware honestly and retain
   refusal for unsupported provisioning; changing appearance must not change
   GPIO, bus type, color order, count, or channel settings.
4. **Elements workflow and rendering.** Retain recoverable drafts across tabs,
   navigation, and refreshes. Repair ordinary “Use controller’s” adoption.
   Keep Save/Apply visible and distinct; add numeric New Element entry, editable
   blank inputs, and clear inclusive–exclusive validation. Handle pointer
   cancellation, scope shortcuts, coalesce pointer processing, and isolate
   static drawing. Support desktop and phone; represent COB sections through
   the same editor logic. The existing Elements panel also has four React lint
   findings: a render-time ref assignment and synchronous state updates in its
   hue-loading, hue-assignment, and unreachable effects.
5. **Shared latency and storage.** Make list reads cache-only and explicit
   refreshes deduplicated and bounded. Reuse Settings reads, prioritize Preview,
   and retain interface/port/visibility discovery behavior. Refuse mutations
   against unreadable stores instead of treating them as empty; retain atomic
   writes and last-good backups. Finish consistent request-error handling
   across the remaining mutations and enforce controller segment limits.
6. **Visual and physical validation.** Capture Lights, Find/enroll, Elements,
   Settings, LED products, and All Off at desktop and phone widths. Browser
   capture was unavailable during review. Measure 60-, 423-, and 1,000-position
   strips; target local feedback within 50 ms, no growing queue, and physical
   response below 200 ms at p95 on the reference LAN. Exercise Cursor, Hold,
   End Preview, and All Off; report simulated results separately from observed
   hardware behavior.
