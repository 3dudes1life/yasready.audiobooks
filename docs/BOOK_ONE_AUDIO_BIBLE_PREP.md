# Book One Audio Bible Prep

0.11.6 is the Residual Review Finalizer. It keeps conservative speaker resolution while separating permanent continuity roles from one-scene extras. The goal remains conservative automation: reduce work only when the manuscript supplies enough evidence, and fail closed when it does not.

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

## Context Resolver Closure

Existing canonical dialogue at confidence >= 0.75 remains eligible for safe binding. 0.11.6 adds evidence-supported resolution for split dialogue/tag/dialogue chains, nearby named antecedents, local pronoun continuity, direct-address exclusion, and a deliberately small set of contextual unnamed roles that are explicit in the manuscript.

Important fail-closed rules:

- reaction-only verbs such as laughing or gasping do not become automatic attribution tags
- an explicit anonymous actor such as `the guy`, `a woman`, `someone`, or `a queen` blocks fallback to the core cast
- the person being addressed cannot become the speaker merely because their name appears in the quote
- pronoun inference does not jump across an anonymous actor or unresolved context shift
- contextual unnamed roles are chapter-scoped and pattern-scoped; they do not become global identities
- alternating-pair guesses are never presented as `quick-confirm`
- ambiguous rows keep `selected_speaker` and `decision` blank

The real Book One queue now has no `quick-confirm` or `manual-identify` rows. The remaining work is either one nearby-speaker suggestion or a multi-speaker context decision.

## Contextual provisional roles

0.11.6 gives every role an explicit continuity scope. Book-level roles may participate in later series continuity; scene-local roles are production-only extras and have no reusable series character key. The New Year’s Eve background couple is therefore represented as `New Year's Couple – Man (Derek)` and `New Year's Couple – Woman`, both scene-local. Derek is no longer a permanent canonical Book One cast member, and the unnamed woman is no longer mislabeled as `Derek's Girlfriend`.

## Displayed text and narration

The quote classifier now also closes safe embedded examples, self-declared labels, playlist titles and collective reveals in addition to the sign/news/message/performance-title patterns from 0.11.4. Those segments are routed to Narrator/displayed-text handling rather than fake speakers.

## Provenance

The prep release and the nested Superman engine are now explicit separate fields. The prep exports `release: 0.11.6`, while `superman.engineRelease` records the underlying Superman engine release. This avoids a stale-looking nested release value without hiding the real engine provenance.

## Pronunciation safety

Pronunciation detection remains conservative and focused on terms that may genuinely need author control. Candidate terms are surfaced for review, but `spoken_as` is always blank. A pronunciation becomes authoritative only after explicit operator approval.

## Real Book One result

On the 56,852-word Book One DOCX:

- Superman: **98/100 PASS**
- review queue: **57** lines, down from 138 in 0.11.4, 176 in 0.11.3 and 281 in 0.11.2
- avoidable review chores removed versus the original prep: **224** (~79.7%)
- safe bindings/resolutions: **1,679**
- narrator-routed quoted/displayed/collective segments: **25**
- provisional roles: **11** total — 4 relational + 7 contextual
- quick-confirm: **0**
- single-nearby-speaker: **5**
- context-review: **52**
- manual-identify: **0**
- pronunciation candidates: **34**
- provider calls: **0**

Known-danger regression cases were audited before release. Reaction tags and generic anonymous actors do not silently steal dialogue from Juan, Michael or Christopher; when the context is not strong enough, the line remains in review.

## Privacy

`dialogue-review.csv` and the prep JSON contain short manuscript excerpts because the operator needs context to make speaker decisions. These outputs belong in the local production workspace and are never included in Git patches or commits.

## Spend

Audio Bible Prep performs **zero provider calls** and never arms paid production. Primary-role casting may begin after the Superman gate passes while the remaining dialogue/pronunciation review is completed in parallel.
