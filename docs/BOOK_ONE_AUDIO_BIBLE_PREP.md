# Book One Audio Bible Prep

0.11.3 keeps the 0.11.2 Audio Bible Prep workflow but adds an intelligence cleanup layer that removes avoidable review chores without silently guessing ambiguous speakers.

## Command

```bash
node src/cli.js audio-bible-prep "/path/to/book_1.docx" --out "$HOME/Desktop/Book-One-Audio-Bible-Prep"
```

Or on macOS:

```bash
bash scripts/RUN_BOOK_ONE_AUDIO_BIBLE_PREP.command "/path/to/book_1.docx"
```

## Output pack

- `book-one-audio-bible-prep.md` — operator summary and next action
- `book-one-audio-bible-prep.json` — structured prep state and targeted review queue
- `character-plan.csv` — canonical names, aliases, role tiers and casting status
- `dialogue-review.csv` — only dialogue lines that still need a human decision, with local context and ranked nearby-speaker suggestions
- `pronunciation-review.csv` — candidate terms with blank `spoken_as`; YasReady never invents a pronunciation
- `audio-bible-snapshot.json` — canonical Audio Bible snapshot/digest for continuity work

## Speaker safety

Existing canonical dialogue at confidence >= 0.75 is auto-bound. 0.11.3 may also auto-resolve only high-confidence cases supported by explicit manuscript evidence: self-identification, direct speech tags, preceding speaker leads, conservative direct-address exclusion, supported relational roles, or quoted/displayed text that belongs to narration. Anything that remains ambiguous stays in the review queue with `selected_speaker` and `decision` blank.

The review queue is sorted to reduce operator work:

1. quick-confirm inferred speaker
2. unresolved line with one nearby-speaker suggestion
3. multi-speaker context review
4. manual identify

## Pronunciation safety

Pronunciation detection is intentionally conservative and now uses a focused Book One watchlist instead of broad proper-noun harvesting. Candidate terms are surfaced for review, but `spoken_as` is always blank. A pronunciation only becomes authoritative after an operator explicitly approves or enters it through the Audio Bible workflow.

## Privacy

Unlike the Superman readiness report, `dialogue-review.csv` and the prep JSON contain short manuscript excerpts because the operator needs context to make speaker decisions. These outputs belong in the local production workspace and are never included in Git patches or commits.

## Spend

Audio Bible Prep performs **zero provider calls** and never arms paid production. Primary-role casting may begin after the Superman gate passes, while remaining dialogue/pronunciation review is completed in parallel.
