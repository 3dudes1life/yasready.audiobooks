# Book One Audio Bible Prep

0.11.7 is the Speaker Truth Closure release. It keeps conservative speaker resolution while separating permanent continuity roles from one-scene extras. The goal remains conservative automation: reduce work only when the manuscript supplies enough evidence, and fail closed when it does not.

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

## Residual Review Finalizer

0.11.6 closes the residual speaker-attribution cases left after 0.11.5 while introducing a hard boundary between reusable Audio Bible identities and one-scene production extras. Existing canonical dialogue at confidence >= 0.75 remains eligible for safe binding; the new finalizer adds evidence-supported post-dialogue attribution, local pronoun/voice antecedents, strict reaction exclusion, and explicit collective dialogue.

Important fail-closed rules:

- reaction-only verbs such as laughing or gasping do not become automatic attribution tags
- an explicit anonymous actor blocks fallback to the core cast unless the manuscript itself supplies enough scene-local identity evidence
- the person being addressed cannot become the speaker merely because their name appears in the quote
- pronoun inference does not jump across an anonymous actor or unresolved context shift
- `they said together` creates a multi-speaker collective binding instead of a fake single-speaker assignment
- scene extras never receive reusable series character keys or enter the permanent Audio Bible snapshot
- alternating-pair guesses are never presented as `quick-confirm`
- any unsupported ambiguity still fails closed to review

## Permanent vs scene-local roles

The permanent Book One Audio Bible contains reusable book-scoped roles; series inheritance remains a 0.12 concern. Scene-local extras are exported separately for production and are excluded from continuity inheritance. In particular, the New Year's Eve background man called Derek is **not** a permanent character. He is represented only as `New Year's Couple – Man (Derek)` inside that scene, while the unnamed woman is `New Year's Couple – Woman`; YasReady no longer invents `Derek's Girlfriend` as a durable identity.

Book One currently has **15 permanent roles** and **8 scene-local extras**. The permanent snapshot contains no Derek or other scene-local background identities.

## Collective dialogue

Collective delivery is modeled explicitly. A line followed by an unambiguous tag such as `they said together` may carry multiple speaker identities. Book One's shared `Te amo` line is therefore represented as a collective binding for Michael Rawlins and Juan Delgado rather than being forced onto one character.

## Displayed text and narration

Quoted labels, signs, news phrases, message fragments, performance titles, embedded examples, playlist titles and similar non-spoken material remain routed to Narrator/displayed-text handling rather than fake dialogue speakers.

## Provenance

The prep exports `release: 0.11.7`, while `superman.engineRelease` separately records the underlying Superman engine release.

## Pronunciation safety

Pronunciation detection remains conservative and focused on terms that may genuinely need author control. `spoken_as` remains blank until the operator explicitly confirms it.

## Real Book One result

On the 56,852-word Book One DOCX:

- Superman: **98/100 PASS**
- speaker-review queue: **0**, after speaker-truth verification of the prior 48 residual 0.11.6 rows; down from 281 in 0.11.2
- review chores safely closed: **281 / 281**
- permanent Audio Bible roles: **15**
- scene-local production roles: **8**
- permanent-role/Narrator bindings: **1,719**
- scene-local resolved segments: **16**
- collective resolved segments: **1**
- total dialogue/displayed-text segments safely resolved: **1,736**
- quoted/displayed-text segments routed to Narrator: **25**
- pronunciation candidates: **32**
- provider calls: **0**

Speaker review is now closed for this manuscript. The remaining human Audio Bible work is pronunciation confirmation and casting/performance decisions, not manually assigning dialogue lines.

## Privacy

`dialogue-review.csv` and the prep JSON contain short manuscript excerpts because the operator needs context to make speaker decisions. These outputs belong in the local production workspace and are never included in Git patches or commits.

## Spend

Audio Bible Prep performs **zero provider calls** and never arms paid production. Primary-role casting may begin after the Superman gate passes while the remaining dialogue/pronunciation review is completed in parallel.
