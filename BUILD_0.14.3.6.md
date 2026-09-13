# YasReady Audiobooks 0.14.3.6 — Real Script Auditions & Human Feedback Loop

0.14.3.6 is the first release that can intentionally spend a small, operator-capped amount on Book One casting auditions.

## The workflow

1. **Plan only — zero spend**
   - Reads the single-narrator discovery artifact.
   - Selects only voices the operator explicitly names, or Keep/Maybe choices from a review export.
   - Uses the five canonical Book One audition excerpts already extracted by YasReady.
   - Estimates exact provider cost.
   - Adds a 25% / $0.02 minimum reserve.
   - Generates an immutable plan fingerprint and one-time plan confirmation token.
   - Performs **zero TTS calls**.

2. **Explicit render approval**
   - Rendering requires the exact plan confirmation token.
   - Rendering also requires an explicit `--max-usd` cap at or above the plan's protected maximum.
   - Audition hard ceiling is $5.00.
   - Wrong token, tampered plan, missing API key/health, or inadequate max cap blocks before TTS.
   - Money Guard checks the audition operation before generation.

3. **Real manuscript audition**
   Every selected narrator reads the same five canonical excerpts:
   - narration opening
   - narration emotional/range passage
   - Juan dialogue
   - Michael dialogue
   - Christopher dialogue

4. **Human feedback**
   - Local Apple-style review board plays the generated MP3s.
   - Keep / Maybe / Pass per voice.
   - 1–5 ratings for Narration, Juan, Michael, Christopher and Overall.
   - Notes field.
   - Exports `real-audition-feedback.json`.
   - Feedback summary preserves explicit human judgment only.
   - YasReady does not claim acoustic identity, ethnicity, or biometric similarity.

## Shared voice handling

YasReady imports selected shared-library voices into the operator's ElevenLabs voice library before rendering when a public owner ID is available. If the voice is already saved, it reuses the saved copy.

## Spend / production boundary

- Audition TTS can run only after explicit token + cap approval.
- Production generation stays unarmed.
- No cast lock is created.
- No narrator is automatically selected after audition.
- Paid auditions and production remain separate operations.

## Book One intelligence cleanup

The release also hardens old biography display data:
- operator-confirmed canon is authoritative for Book One lead region/origin context
- Juan's casting canon includes Florida origin
- DJ occupation evidence is retained for Juan and rejected for Michael/Christopher
- machine-derived manuscript evidence can be high-confidence, but only operator canon is labeled `confirmed`

Character biography data remains performance direction in single-narrator mode, not separate actor casting.
