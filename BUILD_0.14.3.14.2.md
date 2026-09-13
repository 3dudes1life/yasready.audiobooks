# YasReady Audiobooks 0.14.3.14.2 — Voice Depth Calibration

This release responds to the first completed Chapter One production-pilot human review without reopening the narrator performance.

Human review was **MAYBE**: pace and emotional depth were liked; the remaining request was to compare a slightly deeper, less “tinny” finished voice.

## Calibration policy

0.14.3.14.2 performs **zero new provider TTS calls**. It reuses the already-paid Chapter One pilot audio after verifying the stored audio digests from the pilot result.

It generates three local, production-format comparisons:

1. **Original Locked Pilot** — untouched reference.
2. **Warm / De-Tin** — subtle body lift plus restrained upper-mid/air reduction; no pitch change.
3. **Warm + Slightly Deeper** — the same subtle EQ plus a **-0.5 semitone** pitch shift with compensating tempo so the already-approved effective 1.25 pace is preserved.

The deeper local transform intentionally changes pitch/timbre. YasReady does **not** claim formant preservation. Each processed variant is remastered through the existing ACX profile and technically checked before human review.

A human PASS may create a reproducible **local voice finish lock**, but it does not arm production or full-book generation.
