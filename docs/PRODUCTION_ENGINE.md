# YasReady Audiobooks 0.6.0 — Production Engine

The Production Engine is the paid-render safety boundary between approved Director cues and audio providers.

## Core guarantees

- No provider render occurs until a production plan is explicitly armed.
- Preflight prices the initial render plus a dedicated regeneration reserve before arming.
- A hard project budget can block production before a paid request is sent.
- Render text is chunked below provider/model hard limits without losing or reordering text.
- Production records store asset references, never raw audio bytes.
- Identical completed renders may be reused at $0 instead of paying twice.
- Regenerations are intentional, reasoned, force-fresh jobs and consume only the reserved regeneration pool.
- Transient 429/5xx/network failures retry with exponential backoff; quota/auth/validation failures fail closed.
- Provider request IDs, trace IDs and character-cost headers are captured for audit and billing reconciliation.
- A production manifest exposes completion, failures, estimates, actual spend, remaining hard budget and regeneration commitments.

## Long-form continuity

YasReady plans neighboring text context for split chunks. The ElevenLabs adapter forwards `previous_text` and `next_text`, and also supports request-ID context when available. The Production Engine defaults to conservative per-model soft caps rather than using the provider's absolute maximum.

Current hard-limit snapshot used by 0.6.0:

- Eleven v3: 5,000 characters/request; YasReady default cap 4,000.
- Multilingual v2: 10,000; YasReady default cap 8,000.
- Flash/Turbo v2.5: 40,000; YasReady default cap 32,000.

These limits are provider snapshots, not business rules. They live behind `model-limits.js` so they can be updated without changing production workflow logic.

## Production lifecycle

1. Create production plan.
2. Resolve Director cues to locked cast voices.
3. Chunk and estimate every job.
4. Preflight initial cost + regeneration reserve.
5. Operator explicitly arms production.
6. Queue runs with bounded concurrency and retry policy.
7. Audio bytes are handed to an asset sink; only references return to durable state.
8. Review Studio (0.7.0) will approve/reject/re-render these production jobs.

0.6.0 does not automatically run paid provider calls during installation or tests.
