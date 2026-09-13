# YasReady Audiobooks 0.14.3.15 — Production Recipe Lock & Full-Book Preflight

This release merges the confirmed narrator/performance/pace lock with the confirmed Warm + Slightly Deeper local voice-finish lock into one immutable Book One production recipe. It then runs a zero-TTS, zero-provider-spend full-book preflight against live ElevenLabs quota, provider health, FFmpeg, local storage, production manifest, resumability and protected budget.

It **cannot** arm or generate the full book. A `PREFLIGHT-...` token is reference-only and cannot authorize spend. If current live quota is below the full planned provider-character workload, the preflight reports the exact provider-reported deficit and stays blocked.
