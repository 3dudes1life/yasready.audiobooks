# YasReady Audiobooks 0.12.0 — Series Continuity

0.12.0 turns the locked Book One Audio Bible into durable series truth so Book Two and future books can inherit identity, pronunciation and eventually approved cast without accidental drift.

## Changes

- adds a deterministic `series-continuity.json` package with integrity digest
- requires an `AUDIO_BIBLE_LOCKED`, production-ready source with zero speaker/pronunciation/continuity blockers
- promotes permanent Book One roles into stable `seriesCharacterKey` identities
- separates continuity policy into `required`, `carry-forward`, and `reference-only`
- explicitly excludes scene-local extras from series continuity
- preserves explicit pronunciation rules and standard-reading decisions
- converts relationship continuity from source-local character IDs to stable series keys
- adds future-book comparison for recurring/new characters, required-character gaps, role drift and pronunciation conflicts
- fails closed on identity collisions and pronunciation drift
- adds series voice locks keyed by stable character identity; silent recasting is blocked
- materializes a real series Audio Bible and child book Audio Bible through the existing inheritance system
- adds CLI commands and operator runners for seed/compare workflows
- performs zero provider calls and never arms paid generation

## Real Book One validation

The locked 0.11.8 Book One pack seeds **15 permanent roles**, including **4 required identities**, **9 carry-forward identities**, and **2 reference-only roles**. It excludes all **8 scene-local roles** from series continuity, preserves **16 explicit pronunciation rules** plus **16 standard-reading decisions**, and reports **13 pending series voice assignments** before casting. Provider calls remain zero.
