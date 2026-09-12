# YasReady Audiobooks

Professional audiobook production infrastructure for YasReady Publishing.

**Current build: 0.3.0 — Audio Bible**

The project is intentionally standalone while the audiobook workflow is perfected. It will integrate with YasReady Publishing only after the full production pipeline passes real-book stress testing.

## What exists now

### 0.1.0 — Production Foundation
- Book → Chapter → Scene → Segment → Take → Master production architecture
- provider abstraction, cost ledger and duplicate-render protection
- project lifecycle/approval foundations
- private asset references rather than committing audio bytes

### 0.2.0 — Manuscript Brain
- EPUB, DOCX, TXT and Markdown manuscript intake
- chapter/scene segmentation
- narration/dialogue segmentation
- conservative speaker-candidate evidence
- production character/word/runtime metrics
- manuscript hierarchy persistence

### 0.3.0 — Audio Bible
- series and book Audio Bibles with inheritance
- canonical characters, aliases, roles and performance profiles
- relationship graph
- pronunciation rules with book-level overrides
- conservative speaker resolution and auditable bindings
- deterministic Bible digest for future render-cache invalidation
- continuity reporting

## Rules

Do not commit manuscripts, generated audio, voice assets, API keys or customer data to Git.

A manuscript parser may suggest a speaker, but it may never silently create or recast a canonical character. Casting and voice generation come in later builds.
