# YasReady Audiobooks 0.14.2.1 — Catalog Auth Fallback & Discovery UX Hotfix

0.14.2 correctly shipped Book One Casting Candidate Discovery, but the first real ElevenLabs catalog run exposed a provider UX edge case: ElevenLabs now rejects filtered shared-voice searches for logged-out callers with HTTP 401 / `not_logged_in`.

## Fix

- Try the preferred filtered ElevenLabs shared-catalog request first.
- If ElevenLabs returns the specific logged-out/filter 401 and no API key is configured, retry the public shared catalog without protected filters.
- Apply the exact Book One discovery policy locally after that fallback:
  - English-capable
  - professional/high-quality category
  - at least 180 days notice protection
  - no custom sharing rate
  - no live moderation
- Never silently relax those safety requirements.
- Continue paging until the requested Wave 1 slots are filled or the configured page ceiling is reached.
- Report authenticated/filtered vs anonymous fallback mode in JSON, Markdown and CLI summaries.
- If ElevenLabs also blocks the unfiltered catalog, fail with a plain-English message explaining that `ELEVENLABS_API_KEY` is required for read-only catalog discovery.
- This hotfix does not render TTS, arm auditions, lock casts or arm production.

## Spend truth

Catalog browsing may make metadata/network calls. It still performs:

- paid provider calls: 0
- TTS generation calls: 0
- audition renders: 0
- production renders: 0
