# SaaS Boundary Hardening — 0.13.1

0.13.1 is the gate between the Book One/series-specific hardening work and 0.14 External Book Superman.

## Tenant and workflow isolation

Assets and workflow records are project-scoped. Production reuse cannot cross `projectId`. Audition idempotency is limited to the current audition plan. Review Studio rejects jobs outside its project/book/production plan. QA rejects production jobs outside its project/book/production plan. Mastering rejects approved Review/QA records from another project or book.

## Paid-provider boundary

A successful provider render is a billing boundary. Production may retry transient provider failures before a successful response. Once a successful provider response is returned and cost is captured, asset storage runs separately and may fail without causing another TTS call.

Money Guard records provider calls separately from simulated captures. `capturedUsd` / `accountedCapturedUsd` are accounting truth, not a claim that the provider has supplied a settled invoice amount. `costBasis` records whether a value is provider-settled, provider-derived estimate, billed-character estimate or preflight estimate.

## QA protection

When a Money Guard is attached, forced alignment and transcription each require their own authorization before a provider call. The caller must provide a non-negative estimate or use a provider that exposes a matching estimate method. Unknown-cost QA calls fail closed instead of silently assuming zero cost.

## Series refresh and casting truth

Series voice locks require a 0–100 safety score and respect the Casting Room series-safety floor. A package voice lock materializes into a real Casting Room voice assignment. Refreshing a Series Continuity package with `--existing` preserves relationship and voice locks; source-hash changes fail closed for review.

Use:

```bash
bash scripts/RUN_SERIES_CONTINUITY_REFRESH.command \
  "/path/to/book-one-audio-bible-prep.json" \
  "/path/to/series-continuity.json"
```

## Operator UX

Casting is complete only when every Narrator/primary role is locked. Director is complete only when a populated Director plan is locked. The operator-flow status also exposes Money Guard and Series Continuity safety state so the UI cannot imply that paid work is safe merely because a workflow stage exists.
