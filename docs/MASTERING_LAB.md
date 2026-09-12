# YasReady Audiobooks 0.9.0 — Mastering Lab

Mastering Lab is the final audio-finishing gate between approved Review Studio audio and distribution packaging.

## Safety gates

- Requires a locked, approved Review Studio session.
- Requires a locked, approved Continuity + QA run.
- Verifies every selected take has a passing QA gate.
- Preserves region timing so only the approved portion of each take is assembled.
- Requires explicit `arm()` before FFmpeg processing.
- Fails closed when FFmpeg is unavailable or final measurements violate the selected profile.
- Stores only asset references, never raw audio bytes.

## Profiles

Profiles are data, not hard-coded branching logic. `acx-2026`, `spotify-direct-2026`, and `archive-wav-2026` are included. Future standard changes should be handled by adding/revising a profile rather than rewriting the mastering engine.

## ACX 2026 baseline

The profile enforces 44.1 kHz, 192 kbps CBR MP3, RMS between -23 and -18 dB, peaks no higher than -3 dB, noise floor no higher than -60 dB RMS, and 1–5 seconds of edge room tone. Opening and closing credits are required as separate source assets before mastering can be armed, and each credit file is mastered and verified as its own section before finalization.

## FFmpeg pipeline

The default adapter uses:

1. `ffprobe` for stream/duration metadata.
2. `astats`, `volumedetect`, and `silencedetect` for analysis.
3. Lossless PCM extraction for approved review regions.
4. PCM chapter assembly.
5. Two-pass `loudnorm` for conservative normalization.
6. Final profile verification after encode.

Passing the normalization operation is not enough: the final encoded output must independently satisfy the selected profile or the section is rejected.
