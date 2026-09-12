# Series Continuity — 0.12.1

0.12.1 promotes a locked, production-ready book Audio Bible into reusable series truth and hardens that truth with relationship and voice locks that cannot be silently replaced.

## What is preserved

- Narrator and primary characters as **required** series identities.
- Supporting and named minor characters as **carry-forward** identities.
- Provisional generic roles such as Realtor/Landlord as **reference-only** history rather than mandatory future cast.
- Explicit pronunciation rules and standard-reading decisions.
- Relationship continuity using stable `seriesCharacterKey` values.
- Approved series voice locks, once casting is complete.

## Relationship continuity

Relationships from the source Audio Bible are promoted into locked, digest-protected series records. Operators can also add story truth that was not encoded in the source Audio Bible by explicitly locking a pair or a multi-person group.

A relationship lock stores stable character keys, normalized relationship kind, optional label/notes, approval source, revision, override reason and audit history. A locked relationship cannot be silently replaced. Intentional story changes require an explicit override and reason.

A future book is blocked only when it explicitly presents a contradictory relationship for the same locked character pair. A relationship that simply is not mentioned in that book is reported as unobserved, not contradictory.

## Series core lock

`seriesLock.status` begins as `OPEN_FOR_CASTING`. Narrator and every primary character are required voice locks. When those required voice assignments are approved, the state becomes `SERIES_CORE_LOCKED`.

Voice locks are revisioned and digest-protected. Recasting an already locked series voice requires an explicit override and reason, and prior assignment truth remains in audit history.

## What is excluded

Scene-local extras never become permanent series cast. They are recorded only in `sceneLocalExcluded` for auditability. This prevents one-scene roles such as an unnamed guest or background couple from polluting future books.

## Seed a series package

```bash
node src/cli.js series-continuity-seed "/path/to/book-one-audio-bible-prep.json" --out "$HOME/Desktop/Series-Continuity"
```

Or:

```bash
bash scripts/RUN_SERIES_CONTINUITY.command "/path/to/book-one-audio-bible-prep.json"
```

Outputs:

- `series-continuity.json` — machine truth and continuity digest
- `series-continuity.md` — operator summary
- `series-character-map.csv` — stable series identity map
- `series-pronunciations.csv` — explicit and standard pronunciation decisions
- `series-relationships.csv` — locked relationship truth and revision state

## Lock a relationship group

```bash
bash scripts/RUN_SERIES_RELATIONSHIP_LOCK.command \
  "/path/to/series-continuity.json" \
  "michael-rawlins,juan-delgado,christopher-lancaster" \
  "partner" \
  "romantic partner"
```

The generic group lock expands all unique pairs and does not hardcode any book-specific relationship model.

## Lock a voice

```bash
bash scripts/RUN_SERIES_VOICE_LOCK.command \
  "/path/to/series-continuity.json" \
  "michael-rawlins" \
  "elevenlabs" \
  "VOICE_ID" \
  "95"
```

## Compare a future book

```bash
node src/cli.js series-continuity-compare \
  "/path/to/series-continuity.json" \
  "/path/to/next-book-audio-bible-prep.json"
```

The comparison reports recurring/new characters, required-character gaps, role drift, pronunciation conflicts, relationship matches/conflicts/unobserved locks, scene-local counts and current series voice locks. Identity, pronunciation and explicit relationship conflicts fail closed.

## Materialization

`SeriesContinuityService.materializeSeriesBible()` turns a package into a real series-scoped Audio Bible, including locked relationships. `createInheritedBookBible()` creates a book-scoped child Bible that inherits series characters, pronunciations and relationships through the existing Audio Bible inheritance chain.

## Safety

Series Continuity never calls a provider and never arms paid generation. The package contains continuity metadata, not manuscript passages or generated audio.
