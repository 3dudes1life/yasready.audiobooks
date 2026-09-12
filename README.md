# YasReady Audiobooks

Professional audiobook production infrastructure for YasReady Publishing.

**Current build: 0.12.0 — Series Continuity**

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
- 0.11.6 Residual Review Finalizer — closes the residual Book One review cases, separates scene-local extras from permanent continuity, and supports explicit multi-speaker dialogue
- 0.11.7 Speaker Truth Closure — adds a high-authority speaker-truth verifier, protects anonymous self-identification and narrator/media classifications, prunes false one-mention roster noise, and closes Book One speaker review with zero paid calls
- 0.11.8 Audio Bible Lock & Pronunciation Closure — reconciles scene-local/collective dialogue out of false unresolved continuity counts, applies bounded production pronunciation defaults, fixes `DJing` classification, persists explicit pronunciation rules, and emits a locked production-ready Audio Bible when all gates are closed
- 0.12 Series Continuity — promotes locked book-level Audio Bible truth into stable series identities, excludes scene-only extras, preserves pronunciation decisions, blocks silent voice recasting, and provides next-book continuity comparison

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

The prep pack creates canonical character tiers, safely resolves dialogue, preserves the `book` vs `scene` continuity boundary, and writes local dialogue/pronunciation artifacts. 0.11.8 closes the Audio Bible gate: scene-local and collective dialogue count as resolved without becoming permanent cast entries; deterministic pronunciation defaults are persisted only where an explicit rule is useful; standard names/places remain standard-reading rows with no unnecessary override. When speaker review, pronunciation blockers, and continuity unresolved counts are all zero, the pack emits `AUDIO_BIBLE_LOCKED` and `productionReady: true`. The prep run still performs zero provider calls.

## Series Continuity

After a book Audio Bible is locked, promote it into series truth:

```bash
node src/cli.js series-continuity-seed "/path/to/book-one-audio-bible-prep.json" --out "$HOME/Desktop/Series-Continuity"
```

0.12.0 keeps Narrator and primary identities required, carries recurring supporting/named minor roles forward, keeps generic provisional roles reference-only, and excludes scene-local extras entirely. Future books can be compared against the package before production; identity/pronunciation conflicts fail closed, and series voice locks cannot be silently replaced. The Series Continuity workflow performs zero provider calls.

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

Next: **0.13.0 — SaaS Money Guard**. Harden spend authorization, projected-vs-actual cost visibility, provider-budget ceilings and fail-closed paid-generation controls before broader external-book testing.
