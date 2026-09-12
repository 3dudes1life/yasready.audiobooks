# YasReady Audiobooks 0.13.1 — Pre-External Superman / SaaS Boundary Hardening

## Goal

Close the multi-project, paid-provider and operator-flow gaps found in the pre-0.14 Superman audit before testing an unrelated manuscript.

## Hardening added

- Project-scoped production reuse so a render asset can never be reused across projects/tenants.
- Project/plan-scoped audition reuse so a take from another project cannot leak into a new Casting Room plan.
- Review Studio verifies every take belongs to the same project, book and production plan.
- Mastering Lab verifies Review Studio and QA records belong to the same project/book/session.
- QA verifies the production job belongs to the same project/book/production plan.
- Production retries only the provider request. After a successful billable render, downstream storage failure can never trigger a second TTS charge.
- Billable render truth is persisted before asset storage, including `accountedCostUsd`, cost basis and provider request metadata.
- Casting Room releases unused Money Guard reservations in `finally`, including partial authorization and storage-failure paths.
- Continuity + QA now participates in Money Guard with separate `qa_alignment` and `qa_transcription` authorizations and fail-closed cost estimates.
- Money Guard now counts real provider calls separately from simulated capture events.
- Cost accounting distinguishes provider-settled cost from provider-billed-character estimates and preflight estimates.
- Series voice locks now require a Casting Room safety score and block below the series-safety floor unless an explicit reasoned override is used.
- Materialized Series Continuity voice locks become real Casting Room `voice_assignment` records.
- Safe Series Continuity refresh preserves locked relationships and voices and fails closed if the canonical source hash changed.
- Added `RUN_SERIES_CONTINUITY_REFRESH.command` for in-place, non-destructive series refresh.
- Operator Flow now requires all Narrator/primary voice locks, requires a locked Director plan, and exposes Money Guard + Series Continuity safety state.

## Regression

0.13.1 keeps Book One Superman, Audio Bible lock, relationship continuity, Money Guard, Review, QA, Mastering and Distribution behavior intact while adding a dedicated SaaS-boundary regression suite.

No paid provider calls are performed by release validation.
