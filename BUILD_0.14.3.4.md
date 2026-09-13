# YasReady Audiobooks 0.14.3.4 — Single Narrator Casting Pivot

0.14.3.4 changes Book One's production strategy from a four-voice core cast to **one narrator who performs the entire audiobook**.

## Why this pivot exists

The previous casting system treated Narrator, Juan, Michael and Christopher as separate permanent voice actors. That is useful for multicast fiction, but it is not the default production model we want for *Tres Amigos, Una Vida*.

Book One now casts **one narrator** and uses character intelligence as **performance direction** for that narrator.

The default Book One CLI flow is now:

**single narrator search → preview/review → future audition → one narrator lock → character performance guide**

Legacy multicast discovery remains available only with `--multicast`.

## Narrator creative target

The Book One narrator target is:

- male
- young / young-adult
- strong, warm, confident and contemporary
- English-first
- Southern California / California / West Coast delivery preferred
- explicit Latino / Latin-American / Hispanic provider metadata required before auto-audition
- no stereotyped or forced Spanish accent
- no identity inference from the voice name or from how a preview sounds

"Latino" is treated as provider-supplied cultural metadata, not as an acoustic stereotype.

A voice may sound like ordinary contemporary American English and still be an excellent fit.

## Character intelligence changes jobs

Character biographies no longer choose separate Juan/Michael/Christopher voice actors in single-narrator mode.

Instead YasReady creates a **Single Narrator Performance Guide**:

- **Narration:** young, strong, warm Southern California Latino American energy; intimate contemporary romance delivery.
- **Juan:** warm, confident, playful, charismatic; Latino American identity respected without a forced accent.
- **Michael:** grounded and emotionally natural, with a light Oklahoma/Plains country coloration; never cowboy caricature.
- **Christopher:** polished, warm, confident Bay Area/California energy; no stereotyped ethnic accent.

These are performance directions for one narrator, not separate casting targets.

## Audition plan changes

A single-narrator audition now tests the same candidate across both narration and lead-character dialogue.

The audition sample pack collapses to one Narrator role and includes:

- two narration passages
- one Juan passage
- one Michael passage
- one Christopher passage

This allows the operator to judge whether one voice can carry the prose and differentiate the three leads before spending on production.

## Search behavior

Authenticated ElevenLabs discovery now supplements the broad English catalog with zero-spend searches for narrator-fit metadata such as:

- Latino American narrator
- Latino American
- Hispanic American
- Southern California
- California West Coast
- young male narrator
- strong romance narrator

Only one narrator shortlist is produced in the default Book One CLI flow.

## Spend boundary

Paid provider generation calls: 0
TTS generation calls: 0
Audition rendering armed: NO
Production armed: NO
Cast locked: NO
