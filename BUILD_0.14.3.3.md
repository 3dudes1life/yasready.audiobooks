# YasReady Audiobooks 0.14.3.3 — Character Truth Attribution & Preview Integrity

0.14.3.3 closes the failures exposed by the first real 0.14.3.2 Book One casting run.

## What the real run exposed

The full-manuscript biography layer correctly found Michael's Oklahoma/ranch background, but four defects remained:

1. **Character evidence leakage** — travel/context mentions such as visiting San Francisco, asking about Florida, or surviving a trip to Oklahoma could be attached to the nearest named character as if they were origin/residence facts.
2. **Multilingual metadata pollution** — every verified language/accent on an ElevenLabs voice could influence Book Fit, which made generic voices appear to be perfect regional matches.
3. **Wrong-language preview risk** — a voice whose catalog-primary language was Spanish could still rank as a perfect English audiobook candidate because an English capability existed somewhere in `verified_languages`.
4. **Reader-facing back matter in narrator samples** — closing copy such as reader thank-you language could still be selected as a narrator audition excerpt.

## Character truth attribution

Character biography evidence is now assigned by semantic ownership, not "nearest character wins."

Region facts must now look like origin/residence truth, such as:

- `Michael grew up in Oklahoma`
- `Christopher lives in / is back in San Francisco`
- explicit first-person origin/residence from a canonically bound speaker

Travel/context statements are not origin evidence:

- `we booked a weekend in San Francisco`
- `how's Florida?`
- `we survived Oklahoma`
- vacation / flight / hotel / trip mentions
- food names such as California burritos

Occupation/background/identity facts require a direct character mention or safe first-person speaker ownership. A nearby line saying `You're the DJ` cannot turn Michael into a DJ.

## Operator-confirmed Book One canon

The biography package now carries explicit operator-confirmed facts already established for the Book One leads:

- Juan Delgado — Latino American
- Michael Rawlins — young adult, white, Oklahoma/ranch background
- Christopher Lancaster — Asian American, San Francisco Bay Area

Identity facts are **not** treated as acoustic traits and are never inferred from a voice name or preview audio.

The manuscript may reinforce these facts, but proximity heuristics may not overwrite them.

## English preview integrity

Core Book One casting is English-first.

Every candidate must resolve a specific English casting profile and a specific English preview URL before entering the shortlist.

- A catalog-primary non-English voice is excluded from the Book One core pool even if another language capability exists somewhere in the provider metadata.
- An English-primary voice may use a model-specific verified English preview when available.
- Only the selected English profile's accent/locale participates in role and biography scoring.
- Other verified languages no longer leak into regional fit.
- The Review Board explicitly labels preview language and selected English accent.

This fixes cases where a Spanish-primary preview could score 100/100 for the English Narrator.

## Michael age/region fit

Michael's Book One creative target now explicitly treats him as a young adult from an Oklahoma/ranch background.

- young / young-adult metadata is preferred
- middle-aged metadata is a strong stretch
- evidence-backed Oklahoma/country/rural/Plains metadata can qualify for preferred audition
- generic American metadata alone does not satisfy a strong regional Book Fit target
- "white" is retained as character canon but is not converted into an acoustic/racial voice score

## Narrator back-matter hardening

Narrator audition extraction now rejects additional reader-facing and closing-copy patterns such as:

- `thank you for reading`
- `thank you for being a part`
- `this isn't just our story`
- `dear reader`
- `author's note`
- `the end`
- follow/review/newsletter calls to action

## Spend boundary

Paid provider calls: 0
TTS generation calls: 0
Audition rendering armed: NO
Production armed: NO
