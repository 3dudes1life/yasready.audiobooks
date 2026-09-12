# Series Continuity — 0.12.0

0.12.0 promotes a locked, production-ready book Audio Bible into a reusable series continuity package without carrying scene-only extras into future books.

## What is preserved

- Narrator and primary characters as **required** series identities.
- Supporting and named minor characters as **carry-forward** identities.
- Provisional generic roles such as Realtor/Landlord as **reference-only** history rather than mandatory future cast.
- Explicit pronunciation rules and standard-reading decisions.
- Relationship continuity using stable `seriesCharacterKey` values.
- Approved series voice locks, once casting is complete.

## What is excluded

Scene-local extras never become permanent series cast. They are recorded only in `sceneLocalExcluded` for auditability. This prevents one-scene roles such as an unnamed guest or background couple from polluting Book Two and future continuity.

## Seed a series package

```bash
node src/cli.js series-continuity-seed "/path/to/book-one-audio-bible-prep.json" --out "$HOME/Desktop/Series-Continuity"
```

Or:

```bash
bash scripts/RUN_SERIES_CONTINUITY.command "/path/to/book-one-audio-bible-prep.json"
```

The source must be `AUDIO_BIBLE_LOCKED`, production-ready, zero speaker review, zero pronunciation blockers, and zero continuity-unresolved dialogue. The source snapshot digest must match the locked Audio Bible digest.

Outputs:

- `series-continuity.json` — machine truth and continuity digest
- `series-continuity.md` — operator summary
- `series-character-map.csv` — stable series identity map
- `series-pronunciations.csv` — explicit and standard pronunciation decisions

## Compare a future book

```bash
node src/cli.js series-continuity-compare \
  "/path/to/series-continuity.json" \
  "/path/to/next-book-audio-bible-prep.json"
```

The comparison reports recurring characters, genuinely new characters, required-character gaps, role drift, pronunciation conflicts, scene-local counts, and current series voice locks. Identity or pronunciation conflicts fail closed.

## Voice continuity

Series voices are keyed by `seriesCharacterKey`, not ephemeral database IDs. Once a voice is locked, another voice cannot silently replace it. Recasting requires an explicit override and reason.

## Materialization

`SeriesContinuityService.materializeSeriesBible()` turns a package into a real series-scoped Audio Bible. `createInheritedBookBible()` creates a book-scoped child Bible that inherits series characters and pronunciations using the existing Audio Bible inheritance chain.

## Safety

Series Continuity never calls a provider and never arms paid generation. The package contains continuity metadata, not manuscript passages or generated audio.
