# YasReady Audiobooks

Professional audiobook production infrastructure for YasReady Publishing.

**Current build: 0.11.6 — Residual Review Finalizer**

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
- 0.11.1 Book One Superman Cleanup — contextual dialogue attribution, canonical alias grouping, front-matter separation and metadata/path UX fixes
- 0.11.2 Book One Audio Bible Prep — canonical roster tiers, safe high-confidence bindings, targeted dialogue review and pronunciation-review pack
- 0.11.3 Audio Bible Intelligence Cleanup — quoted-text classification, provisional relational speakers, self-identification/direct-address inference, smaller review queue and focused pronunciation review
- 0.11.4 Review Queue Closure — remaining displayed-text closure, safer addressee/pronoun/two-speaker reasoning, zero unsafe quick-confirms and applied-intelligence accounting
- 0.11.5 Context Resolver Closure — split pronoun/tag chains, local actor resolution, reaction-verb safety, contextual anonymous roles, quote-pattern closure and explicit Superman engine provenance
- 0.11.6 Residual Review Finalizer — stronger post-dialogue attribution plus explicit book-vs-scene continuity scope so one-scene extras never become permanent series cast

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

## Book One Audio Bible Prep

After Superman passes, build the local operator pack:

```bash
node src/cli.js audio-bible-prep "/path/to/book_1.docx" --out "$HOME/Desktop/Book-One-Audio-Bible-Prep"
```

The prep pack creates canonical character tiers, safely auto-binds high-confidence dialogue, applies fail-safe Book One intelligence for quoted/non-spoken text and context-supported speakers, and writes targeted dialogue/pronunciation CSVs. 0.11.6 closes additional residual context and introduces explicit `book` vs `scene` continuity scope. One-scene extras remain bindable for production but no longer receive reusable series character keys or pollute future-book continuity. Reaction-only verbs and generic anonymous actors are explicit safety blockers so the resolver prefers review over a confident wrong speaker. Provisional unnamed roles remain explicitly marked. Those local review files contain manuscript excerpts and must not be committed. The prep run performs zero provider calls.

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
- Book One Superman and Audio Bible Prep always perform zero paid provider calls.

## Tests

```bash
npm test
npm run check
node src/cli.js
npm run superman:fixture
node src/cli.js audio-bible-prep <file> --out <directory>
```

## Roadmap

Next: **0.12.0 — Series Continuity**. Promote approved Book One Audio Bible decisions into series-level continuity so Book Two can inherit cast, pronunciations and performance identity without accidental recasting or drift.
