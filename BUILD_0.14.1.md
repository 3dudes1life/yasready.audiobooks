# YasReady Audiobooks 0.14.1 — Production Provenance & Casting Launch

This release closes the confusing version/provenance gap exposed by the real Book One 0.14.0 run and turns the locked Book One Audio Bible into a safe, zero-spend Casting Room launch pack.

## Production provenance

New Audio Bible Prep artifacts identify two different kinds of version truth instead of collapsing them into one stale-looking field:

- **YasReady Audiobooks application/artifact release:** 0.14.1
- **Book One Audio Bible Prep engine:** 0.11.8
- **Book One Superman engine:** whatever engine release actually produced the embedded Superman report
- **Source manuscript hash:** preserved as canonical source truth
- **Audio Bible lock:** records both the 0.14.1 product release and the 0.11.8 prep-engine provenance

The underlying 0.11.8 intelligence is not falsely relabeled as new logic. 0.14.1 makes that subsystem provenance explicit while ensuring the operator sees the current product release.

## Casting Launch

New CLI:

```bash
node src/cli.js casting-launch "/path/to/book-one-audio-bible-prep.json" --out "$HOME/Desktop/Book-One-Casting-Launch"
```

Outputs:

- `casting-launch.json`
- `casting-launch.md`
- `casting-candidates.csv`

Casting waves:

1. Narrator + primary cast — required before Director
2. Supporting cast
3. Minor + provisional permanent roles

Scene-local extras remain excluded from permanent casting waves and are marked on-demand.

## Spend safety

Casting Launch performs zero provider calls, does not arm audition rendering, does not arm production, and keeps Book One voice locks book-scoped until a real Series Continuity `seriesId` exists.

## Validation

Installer runs the 0.14.1 provenance/casting fixture plus the entire existing regression, boundary, closure, Casting Scope Integrity, Book One Superman, External Book Superman, and Money Guard suite before commit/push.

## Fixed installer note

The corrected 0.14.1 installer updates both legacy provenance assertions and safely recovers the release-owned dirty working tree left by the first regression-stopped apply. It will refuse recovery if unrelated local changes are present.
