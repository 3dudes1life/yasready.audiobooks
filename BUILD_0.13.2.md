# YasReady Audiobooks 0.13.2 — Final SaaS Boundary Closure

0.13.2 closes the remaining multi-project and upstream-lock gaps found by the hostile pre-0.14 Superman audit.

## Closure work

- Enforces canonical project/book ownership through Casting Room, Audiobook Director, Production Engine, Review Studio, Continuity + QA and Mastering Lab.
- Makes Audiobook Director plan locks transitive to scenes/cues and requires locked Director truth before planning, arming or rendering production.
- Adds explicit audited recovery for provider-render failures while preventing any post-billing storage failure from triggering a second provider render.
- Requires complete QA coverage for every selected Review Studio take and binds Mastering to evidence from its exact QA run.
- Rejects foreign Audio Bible truth in QA.
- Adds distribution package source digests, stale-package invalidation and fail-closed export/finalization after metadata/mastering truth changes.
- Separates accounted provider-cost estimates from provider-settled actual spend in Production reporting.
- Makes series voice-lock CLI safety score visibly required.
- Tightens operator flow so Director is complete only when the plan and every cue are locked.

## Safety

All validation fixtures are zero-spend. No provider render, QA, alignment or transcription calls are made by the release installer.
