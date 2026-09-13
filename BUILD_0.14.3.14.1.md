# YasReady Audiobooks 0.14.3.14.1 — Eleven v3 Context Compatibility Hotfix

This hotfix fixes the first real Chapter One production attempt being rejected by ElevenLabs before synthesis.

## Provider truth

ElevenLabs returned HTTP 400 `unsupported_model` because `eleven_v3` does not currently accept `previous_text` or `next_text` in the TTS request.

## Fix

- `ElevenLabsProvider.render()` now omits `previous_text` and `next_text` when `model_id` is `eleven_v3`.
- Other supported models keep continuity text unchanged.
- Ryan's locked production recipe is unchanged: Eleven v3, speed 1.20, stability 0.24, local FFmpeg effective 1.25.
- Existing 0.14.3.14 production plan and Chapter One PILOT arm remain accepted so the same spend token and resumable state can be reused.
- Full-book generation remains unarmed.

## Spend safety

The failed real request was rejected with HTTP 400 before any audio response was returned. YasReady recorded it as `PROVIDER_FAILED_SAFE_TO_RETRY`; the hotfix does not discard or bypass the existing pilot state.
