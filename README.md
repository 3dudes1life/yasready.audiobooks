# YasReady Audiobooks

Professional audiobook production infrastructure for YasReady Publishing.

**Current build: 0.11.0 — Book One Superman**

YasReady Audiobooks is being developed as a standalone service first so audiobook experimentation cannot destabilize YasReady Publishing. The product goal is professional long-form audiobook production with strong continuity, human approval gates, cost protection, quality control, mastering and retailer-ready packaging.

## Implemented

- 0.1 Production Foundation — domain model, storage boundaries, cost ledger, duplicate-render protection
- 0.2 Manuscript Brain — EPUB/DOCX/text intake, chapter/scene/dialogue analysis
- 0.3 Audio Bible — canonical characters, aliases, relationships, pronunciations, series continuity
- 0.4 Casting Room — ElevenLabs voice discovery, auditions, series-safety scoring, locked casts
- 0.5 Audiobook Director — non-destructive performance direction, emotion, pacing and restraint
- 0.6 Production Engine — queues, chunking, retries, budgets, caching and regeneration reserve
- 0.7 Review Studio — synchronized takes, approvals, regeneration requests and chapter locks
- 0.8 Continuity + QA Brain — forced alignment, independent transcription, manuscript comparison and findings
- 0.9 Mastering Lab — FFmpeg assembly, loudness/RMS/peak/noise/silence validation and distribution masters
- 0.10 Distribution Brain — platform preflight, metadata/cover validation, W3C manifests, package export and operator UX flow
- 0.11 Book One Superman — full-novel zero-spend stress test, whole-book render rehearsal, character discovery and production/cost readiness report

## Book One Superman

Run a real manuscript without spending on voice generation:

```bash
node src/cli.js superman "/path/to/book.epub" --out "$HOME/Desktop/Book-One-Superman"
```

Or run the synthetic whole-book rehearsal:

```bash
npm run superman:fixture
```

Superman reports hashes, metrics, findings and estimates only; it never exports manuscript text into the report and never arms paid production.

## Current distribution targets

- ACX / Audible technical package
- Spotify for Authors direct-upload package
- Apple Books preferred-partner handoff package
- W3C Audiobook Manifest package

## Core safety rules

- Never commit manuscripts, generated masters, provider keys or customer audio.
- Paid generation is explicitly budgeted and armed before provider calls.
- The canonical manuscript is never rewritten by performance direction.
- Series voice assignments cannot be silently recast.
- Review, QA and mastering decisions are auditable and fail closed.
- Raw audio/cover/package bytes never live in the production domain store.
- Distribution distinguishes technical readiness from platform-policy eligibility.
- Platform requirement profiles are revision-dated and warn when stale.
- Book One Superman always performs zero paid provider calls.

## Tests

```bash
npm test
npm run check
node src/cli.js
npm run superman:fixture
```

## Roadmap

Next: **0.12.0 — Series Continuity**. Prove that Book Two can inherit Book One's canonical cast, pronunciations and performance identity without accidental recasting or continuity drift.
