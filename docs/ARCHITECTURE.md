# Architecture — 0.2.0

## Core hierarchy

`Book -> Chapter -> Scene -> Segment -> Take -> Master`

0.2.0 turns a source manuscript into the first four production layers while preserving source-integrity hashes.

## Manuscript pipeline

`Source file -> Extract -> Normalize -> Structure -> Segment -> Count -> Persist`

Supported source formats are EPUB, DOCX and UTF-8 text/Markdown. EPUB and DOCX are read from their ZIP/XML structures directly with Node built-ins; no external conversion service is required.

## Conservative inference

The manuscript brain must prefer a warning over an invented fact. Dialogue detection is deterministic. Speaker attribution in 0.2.0 is deliberately conservative and is stored only as `speakerCandidate` evidence, never as a locked character assignment. Character identity belongs to the 0.3.0 Audio Bible.

## Source integrity

Each source gets a SHA-256 hash. The normalized manuscript, chapter bodies and scenes also receive hashes. This gives later builds a way to detect changed manuscripts and invalidate only the production work actually affected.

## Money safety

`productionCharacters` is an estimate, not a customer quote. It intentionally excludes future provider wrappers, pronunciation payloads or director markup. Pricing arrives after provider-specific cost modeling.

## Provider boundary

Audio engines continue to implement `AudioProvider`; manuscript code contains no provider HTTP logic.

## Storage safety

Source files and generated audio are never committed to Git. The service stores metadata and opaque private-storage references only.
