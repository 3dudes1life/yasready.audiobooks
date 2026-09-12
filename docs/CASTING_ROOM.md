# YasReady Audiobooks Casting Room — 0.4.0

## Purpose
Casting is a production decision, not a disposable TTS dropdown. A cast assignment can outlive one book, so YasReady stores voice identity, provider identity, safety metadata and approval history independently from generated audio.

## Current ElevenLabs integration
The adapter supports:
- shared Voice Library search (`GET /v1/shared-voices`)
- saved voice listing (`GET /v2/voices`)
- adding a shared voice to the connected collection
- audition TTS (`POST /v1/text-to-speech/:voice_id`)
- pre-render cost estimates with a configurable price snapshot

No API key is committed. Set `ELEVENLABS_API_KEY` in the runtime environment when live auditioning is intentionally enabled.

## Series safety
Series casting scores long-term risk from notice protection, quality/category, verified language, pricing and moderation metadata. Scheduled removal caps the score. Risky voices cannot be locked at series scope unless an operator explicitly overrides the warning and records a reason.

## Spend safety
Every audition plan has a maximum dollar budget. YasReady estimates the full plan before any paid render. Exact duplicate audition renders are fingerprinted and reused.

## Casting hierarchy
A locked book assignment may intentionally override a series assignment. Otherwise a book inherits its series cast. Locked assignments cannot be silently replaced; they require an audited unlock reason.

## Future builds
0.5.0 adds the Director brain. 0.6.0 expands rendering into the production engine. Provider pricing in 0.4.0 is a configurable snapshot, not a billing promise; 0.13.0 will own production quoting and margin protection.
