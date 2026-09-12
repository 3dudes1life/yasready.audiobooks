# Architecture — 0.3.0

## Core hierarchy

`Book -> Chapter -> Scene -> Segment -> Take -> Master`

The production hierarchy remains provider-neutral. 0.3.0 inserts the **Audio Bible** between manuscript analysis and future casting/rendering.

## Manuscript pipeline

`Source file -> Extract -> Normalize -> Structure -> Segment -> Count -> Persist`

Supported source formats are EPUB, DOCX and UTF-8 text/Markdown. EPUB and DOCX are read from their ZIP/XML structures directly with Node built-ins; no external conversion service is required.

## Audio Bible pipeline

`Parser candidate -> Canonical identity lookup -> Human-reviewable resolution -> Audited speaker binding`

Series Bibles own recurring characters and shared pronunciation rules. Book Bibles may inherit one series Bible, add book-only characters, and override pronunciation rules locally without recasting the series.

## Conservative inference

The manuscript brain must prefer a warning over an invented fact. Dialogue detection is deterministic. Speaker candidates remain evidence only until the Audio Bible resolves an exact canonical name or explicit alias. Unknown names remain unresolved rather than being fuzzy-guessed.

## Continuity and render invalidation

Every production-relevant Bible edit increments its revision. `AudioBibleService.snapshot()` produces a deterministic digest of effective characters, profiles, pronunciations, relationships and inheritance. Future rendering builds must include this digest in generation fingerprints so stale audio cannot survive a casting or pronunciation change.

## Source integrity

Each source gets a SHA-256 hash. The normalized manuscript, chapter bodies and scenes also receive hashes. This lets later builds detect changed manuscripts and invalidate only affected production work.

## Money safety

`productionCharacters` is an estimate, not a customer quote. It intentionally excludes future provider wrappers, pronunciation payloads or director markup. Pricing arrives after provider-specific cost modeling.

## Provider boundary

Audio engines continue to implement `AudioProvider`; manuscript and Audio Bible code contain no provider HTTP logic.

## Storage safety

Source files and generated audio are never committed to Git. The service stores metadata and opaque private-storage references only.
