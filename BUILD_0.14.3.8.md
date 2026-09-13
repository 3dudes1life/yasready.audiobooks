# YasReady Audiobooks 0.14.3.8 — Performance Direction & Human Taste Learning

This release stops treating catalog metadata as the final word and turns the first real Book One audition round into a durable human-learning signal.

## Round-one signal supported by this build

The system is designed to ingest `real-audition-feedback.json` from the existing review board. It does not hard-code the current operator choices, but the regression fixture reproduces the real round:

- Ryan Kurk — Keep — best overall; younger quality works; wants more playful/flirty queer-romance energy.
- Hale — Maybe — core voice has potential; Juan delivery is too loud / yell-y.
- Sebastian — Pass — boxy / echoey audio quality.

Ratings are optional. Keep/Maybe/Pass + notes are enough to plan the next round.

## Performance Direction plan

The preferred Keep voice receives three controlled Eleven v3 variants across the same five canonical Book One excerpts:

1. Natural V3 Control
2. Playful + Flirty
3. Warm Romance Narrator

A Maybe voice receives one corrective restraint pass. A Pass voice is excluded automatically.

For the current round that means:

- Ryan: 3 variants × 5 excerpts = 15 clips
- Hale: 1 corrective variant × 5 excerpts = 5 clips
- Sebastian: 0 clips
- Total: 20 clips

## Eleven v3 prompting

The direction engine uses bracketed v3 audio tags such as:

- `[playfully]`
- `[mischievously]`
- `[warmly]`
- `[softly]`
- `[calm]`

The operator phrase "gayer" is translated into performance traits such as playful, flirty, warmer and more emotionally expressive. It is never sent to the provider as an identity tag and never treated as evidence about the speaker's sexual orientation.

## Human Taste Learning

The new learning profile records:

- preferred Keep voice IDs
- Maybe/comparator voice IDs
- rejected Pass voice IDs
- explicit operator notes
- 1–5 ratings when supplied
- deterministic delivery signals derived from explicit notes
- the winning performance-direction variant after round two

It explicitly records that no acoustic embedding, biometric identity, ethnicity inference or sexual-orientation inference was performed.

## Provider entitlement preflight

0.14.3.8 adds an ElevenLabs subscription lookup and checks account tier before paid Voice Library audition rendering. A Free account now fails with a short human-readable message before voice imports or TTS calls.

## Spend protection

Performance Direction is a separate zero-spend plan / explicit-spend render workflow:

- planning performs 0 TTS calls
- immutable plan fingerprint
- `DIRECTION-...` confirmation token
- explicit `--max-usd`
- protected maximum always rounds upward to a usable cent
- $2.00 absolute ceiling for a direction round
- production remains unarmed
- no cast lock is created

## Next boundary

Even if a winning Ryan direction is selected, 0.14.3.8 does not start full-book production. The next step is a separate production-readiness gate using the winning human performance target.
