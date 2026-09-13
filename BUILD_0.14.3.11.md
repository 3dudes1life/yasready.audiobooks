# YasReady Audiobooks 0.14.3.11 — Emotional Lift Tuning

0.14.3.11 takes the successful pacing discovery from 0.14.3.10 and stops touching speed.

## What the prior human round taught us

The prior feedback isolated the problem:

- Faster + More Emotional: pace was liked; still needed more emotion.
- Faster Only: felt like speed-reading without emotion.
- More Emotional Only: tone was liked, but the slower pace still felt wrong.

0.14.3.11 therefore locks the tuning pace at `speed: 1.08` and changes only emotional headroom.

## Three graduated emotional levels

1. **Gentle Emotional Lift** — `speed: 1.08`, `stability: 0.36`
2. **Warm + Expressive** — `speed: 1.08`, `stability: 0.30`
3. **Deep Controlled Emotion** — `speed: 1.08`, `stability: 0.24`

The point is not to make every line emotional. The selected setting becomes headroom for the director:

- everyday/playful scenes stay conversational and buoyant
- romantic/intimate scenes can become warmer and more vulnerable
- conflict, grief and high-emotion scenes may go substantially deeper
- contrast is protected so emotional scenes can actually land

## Guardrails

- same narrator
- same Playful + Flirty base direction
- same Chapter 37 readiness scene
- pace fixed at 1.08
- planning makes zero TTS calls
- immutable `EMOTION-...` token required before rendering
- protected max required
- absolute Emotional Lift ceiling: $1.00
- paid partial rounds resume without regenerating completed stored clips
- provider-success/local-storage-failure is marked DO NOT RERUN
- only one human PASS can create a narrator production lock
- MAYBE / FAIL create no lock
- full-book generation remains unarmed even after PASS
