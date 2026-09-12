# YasReady Audiobooks 0.13.0 — SaaS Money Guard

## Goal

Make accidental or unbounded provider spend structurally difficult before external-book testing and SaaS integration.

## Added

- Project-level `MoneyGuardService` with persistent guard + authorization records.
- Hard project cap, warning threshold, approval threshold and estimate variance buffer.
- Optional per-provider and per-operation ceilings.
- Open-reservation accounting so concurrent workflows cannot each spend the same remaining budget.
- Authorization lifecycle: preview → authorize/reserve → capture actual → release unused reserve.
- Manual emergency lockdown and explicitly approved reopen.
- Provider-overrun detection that records the charge then locks future paid actions.
- Project/provider/operation overrun detection on actual captured spend.
- Casting Room integration with provider-specific audition reservations.
- Production Engine integration with production + regeneration envelope reservation.
- Money Guard status embedded in Production Engine manifests.
- Real billable spend captured before downstream asset storage, so storage failures cannot erase cost truth.
- Zero-spend `money-guard-fixture` CLI/npm validation.

## Safety behavior

Money Guard never arms paid generation by itself. Existing Casting/Production gates remain required. When Money Guard is attached to a workflow, missing/locked/over-cap authorization fails closed before the provider call.

## Regression

0.13.0 keeps Book One Superman, Audio Bible lock, Series Continuity, relationship locks, voice locks, Review, QA, Mastering and Distribution behavior intact.
