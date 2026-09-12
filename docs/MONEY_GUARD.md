# SaaS Money Guard — 0.13.0

Money Guard is the project-level spend control layer for paid audiobook provider actions.

It does not arm generation by itself. A workflow still needs its own explicit production/audition gate. Money Guard answers a different question: **if a paid action is armed, is the spend authorized and bounded?**

## Policy

Each project may have one active guard with:

- project hard cap (`hardCapUsd`)
- warning threshold ratio
- single-action approval threshold
- estimate variance buffer
- optional provider ceilings
- optional operation-class ceilings (audition, production, regeneration, QA, mastering, distribution)

Open reservations count against the project cap before a provider call happens. This prevents two separately safe-looking operations from jointly overspending the project.

## Authorization lifecycle

1. **Preview** — deterministic zero-spend decision: `SAFE`, `WARNING`, or `BLOCKED`.
2. **Authorize** — reserves estimate + configured variance before provider use.
3. **Capture** — records actual billable spend immediately after the provider responds.
4. **Release** — frees unused reservation without deleting captured spend.

Large actions and warning-threshold actions require an explicit approver when policy says so.

## Fail-closed behavior

Money Guard blocks new paid calls when:

- project hard cap would be exceeded
- provider ceiling would be exceeded
- operation ceiling would be exceeded
- an approval-required action has no approver
- the guard is manually locked
- a prior provider overrun forced `locked_overrun`
- a Production Engine authorization is missing

If a provider returns a billable response above its authorization/cap, the real spend is still recorded and the guard locks future spend. The system never hides a real charge merely because a downstream asset/storage step failed.

## Casting Room integration

Audition estimates are grouped by provider. Each provider gets its own Money Guard reservation before any audition render is called. Actual spend is captured once and unused estimate buffer is released at completion.

## Production Engine integration

Arming a production plan reserves its projected initial production + regeneration envelope with Money Guard. Each successful provider response captures actual spend against that authorization. A Money Guard emergency lockdown prevents queued jobs from reaching the provider.

Production's existing per-book hard budget and regeneration reserve remain in force. Money Guard is an additional SaaS/project-level ceiling, not a replacement.

## Cost truth

The Cost Ledger receives Money Guard captures, including billable calls whose later asset storage fails. This keeps projected-vs-actual reporting honest.

## Zero-spend validation

```bash
npm run money-guard:fixture
```

The fixture exercises previews, approval gating, reservation, capture, release, provider/operation/project ceilings and reports `providerCallsPerformed: 0`.
