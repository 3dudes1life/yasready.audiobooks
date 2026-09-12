# YasReady Audiobooks 0.8.0 — Continuity + QA Brain

## Added

- ElevenLabs Forced Alignment provider support.
- ElevenLabs Scribe v2 transcription provider support.
- Canonical manuscript ↔ generated transcript word-diff engine.
- Word error rate, missing-word, substitution and extra-word analysis.
- Adjacent duplicate phrase detection.
- Audio Bible pronunciation-risk checks.
- Alignment-loss, word-duration, overlap and long-silence anomaly checks.
- STT language/word confidence checks.
- QA runs, reports, findings, human resolution/waiver and approval gates.
- Fail-closed QA locking when high/critical findings remain.
- Primary QA transcription is intentionally unbiased by pronunciation keyterms.

## Safety

- No paid provider call occurs in tests or the release demo.
- Audio bytes are transient and supplied via `assetLoader`; QA records never persist raw audio.
- Human review is required to waive blocking findings.
- Provider API remains abstracted; ElevenLabs is an implementation, not the domain architecture.

## Validation

- 21 new QA/provider tests pass in isolation.
- Installer runs the full repository regression suite before commit/push.
- Syntax checks cover all 0.1.0–0.8.0 modules.
- Demo validation invokes `node src/cli.js` directly so npm banners can never break JSON parsing again.
