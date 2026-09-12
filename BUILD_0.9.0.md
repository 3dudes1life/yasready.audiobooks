# 0.9.0 — Mastering Lab

Adds the final audio-finishing layer for YasReady Audiobooks.

- Data-driven mastering/distribution profiles.
- ACX 2026 compliance profile.
- Spotify direct-upload MP3 profile.
- Archival WAV profile.
- FFmpeg/FFprobe health checks and metadata probing.
- Region-accurate extraction from Review Studio timing.
- Approved-take chapter assembly.
- Two-pass loudness normalization.
- RMS / peak / noise-floor / edge-silence verification.
- Required opening/closing credit scripts, source-audio gates, and separately mastered credit files.
- Explicit mastering arm/finalize gates.
- Asset-reference-only persistence.
- Fail-closed mastering when final encoded audio misses profile requirements.

No paid provider calls are made by this release or its tests.
