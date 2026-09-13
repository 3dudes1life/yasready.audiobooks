# YasReady Audiobooks

Professional audiobook production infrastructure for YasReady Publishing.

**Current build: 0.14.3.4 — Single Narrator Casting Pivot**

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
- 0.12.0 Series Continuity — promotes locked book-level Audio Bible truth into stable series identities, excludes scene-only extras, preserves pronunciation decisions, blocks silent voice recasting, and provides next-book continuity comparison
- 0.12.1 Relationship Continuity & Series Lock Hardening — adds locked relationship truth, explicit relationship-change protection, relationship drift comparison, voice-lock audit history and a required-core-voice lock state
- 0.13.0 SaaS Money Guard — adds project/provider/operation spend ceilings, approval thresholds, reservation accounting, projected-vs-actual tracking, emergency lockdown, provider-overrun protection, and Casting/Production fail-closed spend authorization
- 0.13.1 Pre-External Superman / SaaS Boundary Hardening — closes cross-project asset reuse, post-billing retry, QA spend-guard, series voice/materialization, safe-refresh and operator-flow gaps before external-book testing
- 0.13.2 Final SaaS Boundary Closure — enforces canonical project/book ownership through Casting/Director/Production/Review/QA/Mastering, makes Director approval transitive, requires complete exact-run QA coverage, adds safe failed-render recovery, invalidates stale distribution packages, and separates accounted estimates from provider-settled spend
- 0.13.3 Casting Scope Integrity Closure — fails closed when a character is not actually visible to the requested book/series, requires `bookId` for book-scoped locks, and preserves valid series-Bible inheritance
- 0.14.0 External Book Superman — disables Book One identity assumptions, detects prior-book truth leakage, optionally verifies a distinct source hash, and runs an unrelated book through a zero-spend full-stack wiring probe from Audio Bible through W3C distribution packaging
- 0.14.1 Production Provenance & Casting Launch — separates current application/artifact release from subsystem engine provenance and converts a locked Book One Audio Bible Prep artifact into a zero-spend, book-scoped Casting Room launch pack
- 0.14.2 Book One Casting Candidate Discovery — searches the shared professional voice catalog, ranks and uniquely stages Wave 1 candidates, extracts canonical audition samples, previews audition cost, and preserves a hard zero-generation boundary
- 0.14.2.1 Catalog Auth Fallback & Discovery UX Hotfix — retries logged-out ElevenLabs filtered-catalog failures against the public unfiltered catalog, reapplies all safety filters locally, reports auth mode honestly, and preserves the zero-spend boundary
- 0.14.2.2 Anonymous Catalog Pagination & Auth UX — detects ElevenLabs' logged-out 3-voice page limit, paginates the public catalog in safe 3-voice pages, counts fallback HTTP calls honestly, and recommends API-key discovery only if anonymous browsing cannot fill Wave 1
- 0.14.3 Casting Fit & Audition Script Hardening — makes Book One role fit outweigh generic catalog safety, blocks hard-fit mismatches from audition recommendations, removes print-only front matter from Narrator audition scripts, tightens metadata distinctiveness, and adds a local Casting Review Board with preview players plus Keep / Maybe / Pass export
- 0.14.3.1 Character Cultural Fit Hardening — adds explicit-metadata cultural fit for Juan Delgado and regional/context fit for Christopher Lancaster, reserves scarce culturally fitting voices for constrained roles, and performs authenticated zero-spend cultural catalog searches
- 0.14.3.2 Character Biography & Casting Intelligence — reads the full manuscript before casting, derives evidence-backed regional/background voice targets, performs biography-driven zero-spend catalog searches, and adds Book fit to the Casting Review Board
- 0.14.3.3 Character Truth Attribution & Preview Integrity — semantic character fact ownership, operator-confirmed lead canon, English-first preview selection, verified-language leakage blocking, Michael young/Oklahoma hardening and reader-facing narrator back-matter rejection
- 0.14.3.4 Single Narrator Casting Pivot — defaults Book One to one young, strong Southern California Latino American narrator; character intelligence becomes performance direction; legacy multicast requires --multicast\n
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


## Casting Launch

After Book One emits `AUDIO_BIBLE_LOCKED`, create the zero-spend Casting Room launch pack:

```bash
node src/cli.js casting-launch "/path/to/book-one-audio-bible-prep.json" --out "$HOME/Desktop/Book-One-Casting-Launch"
```

0.14.1 launches Narrator + primary characters first, then supporting and later permanent roles. Scene-local extras remain on-demand and outside permanent casting. Candidate discovery and audition planning are allowed, but audition rendering and production remain unarmed until an explicit Money Guard action. Book One locks remain book-scoped until Series Continuity provides a real series ID.


## Casting Candidate Discovery

After `casting-launch.json` is ready, discover and rank real Wave 1 voice candidates without rendering audio:

```bash
node src/cli.js casting-discover \
  "/path/to/casting-launch.json" \
  --prep "/path/to/book-one-audio-bible-prep.json" \
  --manuscript "/path/to/book_1.docx" \
  --out "$HOME/Desktop/Book-One-Casting-Discovery"
```

0.14.2 searches professional English shared voices, applies existing series-safety scoring plus explicit Book One casting-fit defaults, blocks exact voice reuse across the four core Wave 1 shortlists, and warns about metadata similarity without pretending it has measured acoustic similarity. Supplying the exact manuscript reruns the zero-spend Audio Bible intelligence only to extract canonical narration/dialogue audition samples; the source hash must match the Casting Launch. Catalog metadata calls are reported separately from paid/generation calls. Audition rendering, cast locking and production remain unarmed, and `ARM AUDITIONS` is intentionally not available in this build.

## Series Continuity

After a book Audio Bible is locked, promote it into series truth:

```bash
node src/cli.js series-continuity-seed "/path/to/book-one-audio-bible-prep.json" --out "$HOME/Desktop/Series-Continuity"
```

0.12.1 keeps Narrator and primary identities required, carries recurring supporting/named minor roles forward, keeps generic provisional roles reference-only, and excludes scene-local extras entirely. Relationship truth can now be promoted or explicitly operator-locked, future books can be compared for direct relationship drift, and missing relationship mentions are not misclassified as contradictions. Identity, pronunciation and explicit relationship conflicts fail closed; voice and relationship replacements require explicit overrides with reasons and audit history. The Series Continuity workflow performs zero provider calls. 0.13.1 adds non-destructive `--existing` refresh so operator-confirmed relationship and voice locks survive a rebuild, and series voice locks require Casting Room safety scores.

## External Book Superman

0.14.0 is the generalization gate. It analyzes an unrelated manuscript with the Book One alias profile disabled, treats unsupported Book One character/title truth as hostile contamination, and can compare the external source hash against the baseline book. It then uses the external project/book to exercise Audio Bible, Casting, Director, Production + Money Guard, Review, QA, Mastering preflight and W3C Distribution packaging without arming production or making paid provider calls. Review/QA/Mastering/Distribution use synthetic asset references only, so this proves wiring and ownership — not synthesized-audio quality.

Run a real unrelated manuscript:

```bash
node src/cli.js external-superman "/path/to/unrelated-book.epub" --out "$HOME/Desktop/External-Book-Superman"
```

Zero-spend fixture:

```bash
npm run external:fixture
```


### ElevenLabs catalog authentication fallback

ElevenLabs may reject filtered shared-catalog browsing for logged-out callers and may cap anonymous pages at 3 voices. 0.14.2.2 detects both behaviors, paginates the public catalog at the allowed page size, and reapplies the same English/professional-or-high-quality/180-day/no-custom-rate/no-live-moderation policy locally. If anonymous browsing still cannot fill Wave 1, set `ELEVENLABS_API_KEY` in the shell and rerun. Catalog discovery remains read-only and performs zero TTS generation.


### Casting Review Board

A real `casting-discover --out ...` run now writes `casting-review.html`. Open it locally in Safari or another browser to listen to provider previews and mark each candidate **Keep**, **Maybe**, or **Pass**. Decisions autosave in browser local storage and can be exported as `casting-review-decisions.json` with **Export Audition Choices**. The board contains no API key and cannot render paid audio.

0.14.3 also prevents copyright/front-matter text from becoming Narrator audition material and excludes hard casting-fit mismatches from the recommended audition plan.

## SaaS Money Guard

0.13.0 adds the project-level safety envelope. 0.13.1 hardens it across Casting, Production and Continuity + QA: provider calls are counted separately from simulations, QA alignment/transcription require guarded authorization when Money Guard is attached, audition reservations are released on every exit path, and a successful TTS response can never be retried merely because downstream asset storage failed. Captured dollars are **accounted spend** with an explicit cost basis; they are not mislabeled as a settled provider invoice when the provider only exposes billed-character estimates.

Zero-spend validation:

```bash
npm run money-guard:fixture
```

## Current distribution targets

- ACX / Audible technical package
- Spotify for Authors direct-upload package
- Apple Books preferred-partner handoff package
- W3C Audiobook Manifest package

## Core safety rules

- Never commit manuscripts, generated masters, provider keys or customer audio.
- Paid generation is explicitly budgeted and armed before provider calls.
- Money Guard reserves spend before paid calls and enforces project/provider/operation ceilings independently of workflow-local budgets.
- Billable provider responses are recorded before downstream asset storage so real charges cannot disappear from cost truth.
- The canonical manuscript is never rewritten by performance direction.
- Cross-project/book IDs fail closed at Casting, Director, Production, Review, QA and Mastering boundaries.
- Casting also fails closed on exact character-to-book/series membership; book-scoped locks require a real `bookId`.
- Production requires locked Director truth and cannot silently render after that truth is unlocked.
- QA approval requires complete exact-run coverage of every selected Review Studio take.
- Distribution packages become stale when package-producing truth changes and must be rebuilt before export/finalization.
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
npm run boundary:fixture
npm run closure:fixture
npm run casting:fixture
npm run casting:launch:fixture
npm run casting:discover:fixture
node src/cli.js audio-bible-prep <file> --out <directory>
```

## Roadmap

Next: **0.14.x Book One audition approval / Casting Room execution**, then **1.0.0 — YasReady Audiobooks production boundary** after real Book One casting/director/production gates are proven.
