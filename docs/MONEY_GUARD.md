# SaaS Money Guard — 0.13.1

Money Guard is the project-level spend control layer for paid audiobook provider actions. It does not arm generation by itself; it decides whether an already-approved paid action is authorized and bounded.

## Policy

Each project may have one active guard with a project hard cap, warning threshold, single-action approval threshold, estimate-variance buffer, optional provider ceilings, and optional operation-class ceilings (audition, production, regeneration, QA, mastering and distribution). Open reservations count against the cap before provider calls.

## Authorization lifecycle

1. **Preview** — deterministic zero-spend decision: `SAFE`, `WARNING`, or `BLOCKED`.
2. **Authorize** — reserves estimate + configured variance before provider use.
3. **Capture** — records accounted provider spend immediately after a successful provider response.
4. **Release** — frees unused reservation without deleting captured spend.

0.13.1 also tracks `providerCallsPerformed` separately from simulated captures. Test fixtures can exercise accounting without pretending a real provider was called.

## Fail-closed behavior

Money Guard blocks new paid calls when the project/provider/operation cap would be exceeded, approval is missing, the guard is locked, an overrun triggered lockdown, or a required authorization is missing. If a provider response is billable and downstream storage later fails, the cost remains captured.

## Casting Room integration

Audition estimates are reserved by provider before rendering. 0.13.1 releases unused reservations in `finally`, including authorization failures, render failures and asset-storage failures. A captured charge is preserved while only the unused buffer is released.

## Production Engine integration

Arming production reserves the initial + regeneration envelope. Provider retries stop at the successful provider response. Asset storage is a separate phase: if storage fails after billing, TTS is **not called again**. The job keeps provider request metadata and accounted spend for auditability.

## Continuity + QA integration

When Money Guard is attached, alignment and transcription each require their own authorization (`qa_alignment`, `qa_transcription`) before a provider call. Unknown-cost QA calls fail closed: the caller must supply a non-negative estimate or the provider must expose an estimate method.

## Cost truth

`capturedUsd` and `accountedCapturedUsd` are accounting truth, not necessarily a settled provider invoice. `costBasis` distinguishes provider-settled values, provider/billed-character estimates, preflight estimates and simulations.

## Zero-spend validation

```bash
npm run money-guard:fixture
npm run boundary:fixture
```

Both release fixtures perform zero external provider calls.
