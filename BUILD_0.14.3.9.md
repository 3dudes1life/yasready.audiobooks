# YasReady Audiobooks 0.14.3.9 — Production Readiness Gate & Operator UX Hardening

0.14.3.9 closes the gap between short audition clips and real full-book production.

## Production Readiness Gate

A completed 0.14.3.8 human-learning result is now required. The gate:

- requires an explicit human `BEST` performance-direction winner
- verifies the manuscript source hash against the learned Book One source
- automatically selects a contiguous 155–235 word real manuscript sample
- requires narration before dialogue and narration after dialogue
- prefers samples with Juan / Michael / Christopher represented
- estimates 60–90 seconds at normal audiobook pace
- compiles the human-winning performance direction non-destructively
- keeps canonical manuscript text separate from provider direction tags
- makes exactly one readiness TTS call when explicitly approved
- requires an immutable `READINESS-...` token and `--max-usd`
- uses a $1.00 absolute readiness ceiling
- never arms full-book production during planning or readiness rendering

## Human production gate

The readiness review board has exactly three operator decisions:

- PASS — create narrator production lock + performance profile
- NEEDS TUNING — no lock; tune direction and rerun readiness
- FAIL — no lock; return to casting/performance direction

Only PASS creates `narrator-production-lock.json`. Even after PASS, `productionArmed` and `fullBookGenerationArmed` remain false. A later production-plan/budget arm is still required.

## Operator UX hardening

Restricted API keys that lack `user_read` no longer explode with a raw subscription 401. The provider subscription preflight now marks that check unavailable and safely continues to the authenticated voice/TTS checks. A readable Free tier still blocks before TTS. A provider `paid_plan_required` 402 becomes a short non-retryable operator error.

Performance Direction and Production Readiness review boards now provide an explicit download action, save-file picker where supported, Safari Blob-download fallback, visible export status, and Copy Feedback JSON fallback.
