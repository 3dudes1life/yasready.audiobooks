# Distribution Brain — 0.10.0

Distribution is a packaging and readiness layer. It does not pretend that a technically valid file guarantees acceptance by a retailer.

## Targets

- **ACX / Audible technical package** — ACX-compatible master, chapter/credit files, cover validation, ASCII-safe filenames, and a manual narration-eligibility confirmation when digital narration is used.
- **Spotify for Authors direct upload** — MP3/WAV/FLAC readiness, 2-hour chapter ceiling, digital-narration disclosure, square cover, metadata checks, and sample recommendation.
- **Apple Books preferred-partner handoff** — builds a clean partner package and explicitly preserves partner-specific policy checks.
- **W3C Audiobook Manifest** — emits a JSON-LD manifest with reading order, narrator, duration and cover metadata.

## Safety rules

1. Mastering must be finalized and locked before distribution.
2. Rights/territories must be confirmed before packaging.
3. Raw audio bytes are never stored in the domain store.
4. Every target gets an independent preflight with blockers, warnings and one next action.
5. Profile rules carry a revision date; stale rules warn instead of silently pretending to be current.
6. Technical compliance and platform eligibility are separate concepts.

## Package layout

```
audio/
artwork/
metadata/metadata.json
metadata/audiobook-manifest.json
CHECKLIST.txt
```
