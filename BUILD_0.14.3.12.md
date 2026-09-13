# YasReady Audiobooks 0.14.3.12 — Pace Ceiling Calibration

0.14.3.12 resolves the new human feedback without sending unsupported speed values to ElevenLabs.

## Human evidence carried forward

The Emotional Lift review said:

- Gentle Emotional Lift — MAYBE: “WAY TOO SLOW - do 1.25 speed”
- Warm + Expressive — FAIL: “do not like”
- Deep Controlled Emotion — MAYBE: “WAY TOO SLOW - do 1.25 speed”

Warm + Expressive is removed. Gentle and Deep survive.

## Provider ceiling + effective 1.25

ElevenLabs' documented native TTS speed range tops out at 1.20. YasReady therefore never sends 1.25 to the provider.

For each surviving emotional direction, YasReady creates:

- a paid ElevenLabs take at the real native ceiling `speed: 1.20`
- a local pitch-preserving FFmpeg `atempo` derivative with multiplier `1.25 / 1.20 = 1.041667`

The review board exposes four clips:

1. Gentle Emotional Lift — Native 1.20
2. Gentle Emotional Lift — Effective 1.25
3. Deep Controlled Emotion — Native 1.20
4. Deep Controlled Emotion — Effective 1.25

Only **two** provider TTS calls are paid. The two 1.25 comparison clips are local transforms with $0 additional TTS spend.

## Spend and duplicate protection

- planning performs zero provider generation
- FFmpeg health is checked before any paid TTS call
- explicit `PACE-...` token required
- protected max required
- calibration hard ceiling remains $1.00
- stored paid base clips are reused after partial provider failure
- local tempo failures are safe to rerun without repeating paid TTS
- provider-success/local-storage-failure remains DO NOT RERUN
- a PASS on effective 1.25 records provider speed 1.20 + exact tempo multiplier in the production profile
- full-book generation remains unarmed even after PASS
