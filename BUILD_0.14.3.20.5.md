# YasReady Audiobooks 0.14.3.20.5 — Human Pause Review & Local Repair Preview

- Short bounded original preview clips for localized defects.
- Silence-only A/B Preview Fix for `LOCAL_REPAIR_SAFE` boundaries.
- Explicit Approve Fix / Leave As-Is / Needs Review decisions with server-side autosave.
- Listening and previewing can never create repair authorization.
- Surgical/manual boundaries can never auto-repair.
- Approved fixes write new derivative chapter MP3s only; source Direct MP3s are digest-verified and immutable.
- Post-repair FFmpeg silence detection must prove every applied boundary meets its pause floor within tolerance.
- Zero provider calls, zero TTS, zero provider spend.
- Chapter 11, next batch and full-book generation remain OFF.
