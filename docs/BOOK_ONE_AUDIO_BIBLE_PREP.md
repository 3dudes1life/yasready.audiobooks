# Book One Audio Bible Prep

0.11.4 keeps the Audio Bible Prep workflow but closes additional avoidable review work found in the real 0.11.3 Book One pack. The goal is not maximum automation; it is a smaller queue whose remaining rows genuinely deserve a human decision.

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
- `book-one-audio-bible-prep.json` — structured prep state, intelligence accounting and targeted review queue
- `character-plan.csv` — canonical names, aliases, role tiers and casting status
- `dialogue-review.csv` — only dialogue lines that still need a human decision, with local context and ranked nearby-speaker suggestions
- `pronunciation-review.csv` — focused candidate terms with blank `spoken_as`; YasReady never invents a pronunciation
- `audio-bible-snapshot.json` — canonical Audio Bible snapshot/digest for continuity work

## Speaker safety

Existing canonical dialogue at confidence >= 0.75 remains eligible for safe binding. 0.11.4 can additionally resolve only evidence-supported cases such as explicit self-identification, local speech tags/leads, supported relational roles, tightly constrained pronoun continuation, stable two-speaker turn evidence, direct-address exclusion, and quoted/displayed text that belongs to narration.

Important fail-closed rules:

- the person being addressed cannot become the speaker merely because their name appears in the quote
- relational-role evidence is evaluated before direct-address guessing
- anonymous third-speaker introductions block two-person reaction logic
- pronoun inference does not jump across unresolved turns
- alternating-pair guesses are never presented as `quick-confirm`
- ambiguous rows keep `selected_speaker` and `decision` blank

The review queue is ordered as:

1. unresolved line with one nearby-speaker suggestion
2. multi-speaker/context review
3. true manual identify

`quick-confirm` remains supported by the schema for compatibility, but 0.11.4 deliberately produces none for the real Book One pack because the remaining inferred cases are not safe enough for one-click approval.

## Displayed text and narration

0.11.4 recognizes additional non-character quotes when manuscript context supports them, including signs/titles, news-described terms, bracketed message fragments, hypothetical quoted phrases, performance/song titles and collective quoted speech. These are bound to Narrator/displayed-text handling instead of creating fake speaker chores.

The report distinguishes **detection counts** from **applied resolution counts**. `quotedNarrationSegments` is based on the bindings actually routed to Narrator, so the operator summary and Audio Bible state use the same source of truth.

## Pronunciation safety

Pronunciation detection remains conservative and focused on terms that may genuinely need author control. Candidate terms are surfaced for review, but `spoken_as` is always blank. A pronunciation becomes authoritative only after explicit operator approval.

## Real Book One result

On the 56,852-word Book One DOCX:

- Superman: **98/100 PASS**
- review queue: **138** lines, down from 176 in 0.11.3 and 281 in 0.11.2
- avoidable review chores removed versus the original prep: **143**
- safe bindings: **1,598**
- narrator-routed quoted/displayed/collective segments: **21**
- provisional roles: **4**
- quick-confirm: **0**
- single-nearby-speaker: **26**
- context-review: **109**
- manual-identify: **3**
- pronunciation candidates: **34**
- provider calls: **0**

## Privacy

`dialogue-review.csv` and the prep JSON contain short manuscript excerpts because the operator needs context to make speaker decisions. These outputs belong in the local production workspace and are never included in Git patches or commits.

## Spend

Audio Bible Prep performs **zero provider calls** and never arms paid production. Primary-role casting may begin after the Superman gate passes while remaining dialogue/pronunciation review is completed in parallel.
