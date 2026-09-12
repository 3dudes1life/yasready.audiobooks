# YasReady Audiobooks 0.11.2 — Book One Audio Bible Prep

Turns the real Book One Superman result into an operator-ready Audio Bible prep pack without provider spend.

## Added

- canonical Book One character plan with narrator / primary / supporting / minor tiers
- real `audio_bible` + `character` records generated from the approved Superman roster
- high-confidence dialogue bindings created automatically while preserving source confidence/evidence
- targeted dialogue-review queue for only lines that still need a human decision
- nearby-speaker suggestions for unresolved dialogue without silently assigning a speaker
- conservative pronunciation candidate review with **no guessed pronunciations**
- local CSV/JSON/Markdown operator pack and Audio Bible snapshot
- `scripts/RUN_BOOK_ONE_AUDIO_BIBLE_PREP.command`
- `node src/cli.js audio-bible-prep <file> --out <directory>`

## Book One validation

Against the real Kindle Create `book_1.docx` used in 0.11.1:

- Superman gate: 98/100 PASS
- Audio Bible roles: 13 including Narrator
- primary characters: 3
- supporting characters: 3
- minor candidates: 6
- high-confidence dialogue auto-bound: 1,455
- targeted dialogue review: 281
  - 57 quick confirms
  - 49 with one nearby-speaker suggestion
  - 164 context reviews
  - 11 manual-identify lines
- pronunciation candidates: 46 conservative review terms
- provider calls: 0

The review CSV intentionally contains manuscript excerpts and must remain local/operator-only. It is never committed by the installer.
