# YasReady Audiobooks 0.14.3.2 — Character Biography & Casting Intelligence

0.14.3.2 changes the order of operations for Book One casting:

**Understand the character from the full manuscript first. Then search and rank voices.**

The previous casting passes were good at safety, metadata quality and basic role fit, but they could still surface voices that sounded wrong because the system began with a small hand-written casting profile instead of first building an evidence-backed character biography from the book.

## Full-manuscript casting biographies

When `casting-discover` is run with `--manuscript`, YasReady now analyzes the fresh full-manuscript prep result and builds a local casting biography for every Wave 1 character.

The biography engine looks for manuscript-supported evidence such as:

- home region / place of origin
- rural, farm, ranch, urban or regional background
- explicitly stated cultural identity
- explicit language / bilingual cues
- explicit accent, drawl or speech-style cues
- age-band cues when stated
- occupation / lifestyle cues that materially affect voice casting

Evidence is attached to the nearest unambiguous character mention in the scene and includes chapter/location, confidence and a short local excerpt.

YasReady does **not** infer race, ethnicity or nationality from a character name.

## Voice target derivation

The biography is converted into a casting target.

Example: when the manuscript supports both **Oklahoma** and **farm/rural background** for a character, YasReady derives a voice target such as:

> mild Oklahoma / Plains country coloration — contemporary, not caricature

That target can prefer metadata such as `oklahoma`, `country`, `rural american`, or `southern american` while still rejecting old/grandpa or exaggerated-character voices through the existing age/use-case fit rules.

A generic American voice can remain visible as an alternate, but when the manuscript evidence is strong enough it is no longer automatically promoted to `AUDITION` over a regionally fitting candidate.

## Existing cultural-fit rules remain

0.14.3.1 behavior is preserved:

- Juan Delgado requires explicit Latino / Latin-American / Hispanic provider metadata before auto-audition.
- American/neutral Latino delivery remains fully valid.
- Christopher Lancaster is treated as Asian American from the Bay Area without requiring an ethnic accent.
- Cultural identity is never inferred from audio or a voice name.

## Biography-driven provider discovery

Authenticated ElevenLabs discovery now supplements the broad catalog pass with **zero-spend metadata searches derived from the manuscript biography**.

Search terms are deduplicated and capped.

Examples may include:

- `oklahoma`
- `country american`
- `rural american`
- `bay area`
- `california`
- explicit manuscript-supported identity terms

These are catalog metadata calls only. They do not invoke TTS and do not arm paid generation.

## Casting Review Board

`casting-review.html` now shows:

- Full-book casting biography
- manuscript-supported evidence summary
- derived voice target
- Book-fit score for each candidate
- cultural fit where applicable
- role fit
- series safety
- Keep / Maybe / Pass

The discovery folder also includes:

- `character-casting-biographies.json`
- `character-casting-biographies.md`

These are sensitive local production artifacts and should stay out of GitHub.

## Spend boundary

Paid provider calls: 0
TTS generation calls: 0
Audition rendering armed: NO
Production armed: NO
