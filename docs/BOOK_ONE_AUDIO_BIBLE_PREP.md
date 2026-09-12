# Book One Audio Bible Prep

0.11.8 is the **Audio Bible Lock & Pronunciation Closure** release. It closes the Book One prep gate without turning one-scene extras into permanent continuity identities and without forcing the operator to manually confirm ordinary pronunciations.

## Command

```bash
node src/cli.js audio-bible-prep "/path/to/book_1.docx" --out "$HOME/Desktop/Book-One-Audio-Bible-Prep"
```

Or on macOS:

```bash
bash scripts/RUN_BOOK_ONE_AUDIO_BIBLE_PREP.command "/path/to/book_1.docx"
```

## Output pack

- `book-one-audio-bible-prep.md` — operator summary, gates and next action
- `book-one-audio-bible-prep.json` — structured prep state, lock state and intelligence accounting
- `character-plan.csv` — permanent canonical names, aliases, role tiers and casting status
- `dialogue-review.csv` — header-only when speaker truth is fully closed
- `pronunciation-review.csv` — every pronunciation candidate plus its deterministic production resolution and optional override surface
- `audio-bible-snapshot.json` — locked canonical Audio Bible snapshot/digest including persisted pronunciation rules

## Lock contract

The Audio Bible locks only when all four production-prep gates are closed:

1. `superman.status === PASS`
2. `dialogueReview.needsReview === 0`
3. `pronunciationReview.needsConfirmation === 0`
4. `continuity.unresolvedDialogueSegments === 0`

A locked pack reports `status: AUDIO_BIBLE_LOCKED`, `gates.productionReady: true`, `gates.audioBibleLocked: true`, and `lock.status: LOCKED`. Paid generation remains disabled.

## Continuity reconciliation

The generic Audio Bible store binds permanent characters and Narrator directly. Scene-local extras and explicit collective dialogue are intentionally not permanent single-character bindings. 0.11.8 therefore preserves the raw unbound count as `continuity.unboundInPermanentBible`, records `externallyResolvedDialogueSegments`, and reports only truly unresolved dialogue in `continuity.unresolvedDialogueSegments`.

For real Book One, the prior raw count of 17 is exactly **16 scene-local resolved segments + 1 collective resolved segment**, so the production continuity unresolved count is now correctly **0**.

## Pronunciation closure

Pronunciation review is now non-blocking when YasReady can safely apply a bounded production policy:

- standard character names, book title text and ordinary place names are marked `standard-reading`; no unnecessary rule is stored
- clear initialisms such as `DJ`, `SF`, `IG`, `DM`, `NYE`, `VIP`, `ABE`, `AF`, `CS`, and `DIY` receive explicit letter-by-letter rules
- `D.C.W.` is explicitly read as initials
- `Te amo` is retained with Spanish locale metadata
- `DILF` uses the common lexicalized spoken form
- `DJing` is correctly classified as `acronym-derived` and receives the production form `dee jaying`
- `LOL` and `LMAO` default to letter-by-letter in message narration while remaining author-overridable

The CSV remains an override surface, not a mandatory chore.

## Permanent vs scene-local roles

The permanent Book One Audio Bible contains **15 reusable book-scoped roles**. The **8 scene-local extras** remain outside the permanent snapshot/series identity model. Derek exists only as `New Year's Couple – Man (Derek)` for the Chapter 34 scene and never receives a reusable series character key.

## Real Book One result

On the 56,852-word Book One DOCX:

- Superman: **98/100 PASS**
- total dialogue/displayed-text segments safely resolved: **1,736 / 1,736**
- speaker-review queue: **0**
- original review chores closed: **281 / 281**
- permanent Audio Bible roles: **15**
- scene-local production roles: **8**
- permanent-role/Narrator bindings: **1,719**
- scene-local resolved segments: **16**
- collective resolved segments: **1**
- pronunciation candidates: **32 / 32 resolved**
- explicit pronunciation rules persisted: **16**
- standard-reading candidates requiring no rule: **16**
- pronunciation items requiring author confirmation: **0**
- continuity unresolved dialogue: **0**
- Audio Bible status: **AUDIO_BIBLE_LOCKED**
- production ready: **YES**
- provider calls: **0**

## Privacy and spend

The local prep artifacts may contain manuscript-derived production context and must not be committed. Audio Bible Prep performs **zero provider calls** and never arms paid generation.
