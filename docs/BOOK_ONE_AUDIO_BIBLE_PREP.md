# Book One Audio Bible Prep

0.11.2 converts a passing Book One Superman run into the first real production-control artifact: a prepared Audio Bible plus small, explicit human review queues.

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

Only dialogue with a canonical speaker candidate at confidence >= 0.75 is auto-bound. Lower-confidence contextual inference stays in the review queue. Completely unresolved lines receive nearby-speaker suggestions, but `selected_speaker` and `decision` remain blank.

The review queue is sorted to reduce operator work:

1. quick-confirm inferred speaker
2. unresolved line with one nearby-speaker suggestion
3. multi-speaker context review
4. manual identify

## Pronunciation safety

Pronunciation detection is intentionally conservative. Candidate terms are surfaced for review, but `spoken_as` is always blank. A pronunciation only becomes authoritative after an operator explicitly approves or enters it through the Audio Bible workflow.

## Privacy

Unlike the Superman readiness report, `dialogue-review.csv` and the prep JSON contain short manuscript excerpts because the operator needs context to make speaker decisions. These outputs belong in the local production workspace and are never included in Git patches or commits.

## Spend

Audio Bible Prep performs **zero provider calls** and never arms paid production. Primary-role casting may begin after the Superman gate passes, while remaining dialogue/pronunciation review is completed in parallel.
