# 0.6.0 — Production Engine

Built the paid-generation and reliability layer for YasReady Audiobooks.

## Added

- Model-aware, lossless TTS chunking with conservative safety caps
- Production plans, jobs, preflight and explicit arming gate
- Hard budget + regeneration reserve accounting
- Bounded concurrent worker queue
- Retry/backoff classification for 429, provider-busy, 5xx and network failures
- Fail-closed handling for auth, quota, validation and invalid request failures
- Completed-render reuse to prevent duplicate provider spend
- Audited force-fresh regeneration jobs
- Provider request/trace ID and character-cost capture
- Neighbor-context continuity fields for long-form generation
- Production manifest with completion, failure and spend state
- Asset-sink protection preventing raw audio bytes from entering durable records
- CLI version correction

## Validation

- 62/62 tests passing
- Full 0.1.0–0.5.0 regression suite retained
- Syntax checks passing
- Demo passing
- No live provider generation performed
