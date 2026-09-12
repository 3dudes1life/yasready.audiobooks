# YasReady Audiobooks 0.11.8 — Audio Bible Lock & Pronunciation Closure

0.11.8 closes the Book One Audio Bible prep gate after 0.11.7 completed speaker truth.

## Changes

- fixes the false continuity `unresolvedDialogueSegments: 17` by reconciling 16 scene-local + 1 collective segment as already resolved
- preserves raw permanent-binding visibility via `unboundInPermanentBible` and `externallyResolvedDialogueSegments`
- resolves all 32 Book One pronunciation candidates through a bounded production policy
- persists 16 explicit pronunciation rules and leaves 16 ordinary terms as standard readings without unnecessary overrides
- fixes `DJing` from `place-or-proper-name` to `acronym-derived`
- gives text-message defaults for `LOL`/`LMAO` while keeping the CSV as an optional author override surface
- stores `D.C.W.` as letter-by-letter initials and `Te amo` with Spanish locale metadata
- advances prep schema to 7 and release markers to 0.11.8
- emits `AUDIO_BIBLE_LOCKED` only when speaker, pronunciation and continuity gates are all closed
- keeps paid generation disabled

## Real Book One validation

The 56,852-word Book One DOCX reports 1,736/1,736 safely resolved dialogue/displayed-text segments, zero speaker-review rows, 32/32 pronunciation candidates resolved, 16 persisted pronunciation rules, zero continuity-unresolved dialogue, `productionReady: true`, `audioBibleLocked: true`, and zero provider calls.
