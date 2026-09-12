# YasReady Audiobooks 0.12.1 — Relationship Continuity & Series Lock Hardening

0.12.1 closes the relationship-continuity gap found in the real 0.12.0 Book One series package and hardens series-level lock behavior before Book Two inheritance and paid production.

## Changes

- promotes source Audio Bible relationships into deterministic, digest-protected series relationship locks
- adds operator-confirmed relationship locks keyed by stable series character identities
- adds multi-person relationship locking that expands a group into every unique pair without hardcoding any book or relationship model
- blocks silent relationship replacement; intentional story changes require an explicit override and reason
- preserves prior relationship truth in revisioned audit history
- compares explicit next-book relationship observations against series truth and fails closed on direct drift
- does **not** treat a relationship that simply is not mentioned in the next book as a contradiction
- adds `series-relationships.csv` to Series Continuity operator artifacts
- hardens voice locks with safety-score validation, revision numbers and recast audit history
- adds a derived `seriesLock` state that remains `OPEN_FOR_CASTING` until Narrator + all required primary voices are locked, then becomes `SERIES_CORE_LOCKED`
- keeps reference-only and scene-local boundaries intact
- preserves zero-provider-call / no-paid-generation behavior

## Operator commands

Lock a durable relationship group:

```bash
node src/cli.js series-continuity-lock-group series-continuity.json \
  --members michael-rawlins,juan-delgado,christopher-lancaster \
  --kind partner \
  --label "romantic partner" \
  --out series-continuity.json
```

Lock an approved series voice:

```bash
node src/cli.js series-continuity-lock-voice series-continuity.json \
  --character michael-rawlins \
  --provider elevenlabs \
  --voice-id VOICE_ID \
  --safety-score 95 \
  --out series-continuity.json
```

## Safety

Relationship and voice truth are digest-protected. A locked relationship or voice cannot be silently replaced. Overrides must be explicit and include a reason. Future-book comparison blocks explicit contradictory relationship observations but does not invent conflict when a relationship is merely absent from a manuscript.
