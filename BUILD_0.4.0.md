# 0.4.0 — Casting Room

Adds provider-aware audiobook casting without requiring a live provider call in tests.

## Added
- normalized voice profiles
- long-term series safety scoring
- ElevenLabs Voice Library and saved-voice adapter
- shared voice import support
- cost-estimated audition plans
- hard audition spend ceilings
- duplicate audition render reuse
- series/book cast hierarchy
- locked cast assignments with audited recasting
- configurable ElevenLabs pricing snapshot

## Release gate
The automated suite must preserve every previous test and pass all Casting Room tests without a live API key or billable provider call.
