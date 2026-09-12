# YasReady Audiobooks 0.11.5 — Context Resolver Closure

## Why this build exists

0.11.4 reduced Book One's dialogue review queue to 138 lines, but the real pack still contained context the machine could safely resolve: split `he/she said` chains, nearby named actors, and clearly scoped one-scene unnamed speakers. 0.11.5 removes that avoidable work without turning uncertain prose into confident guesses.

## What changed

- resolves split dialogue → pronoun tag → dialogue chains when the local antecedent is explicit
- follows nearby named same-gender actors conservatively when pronouns are locally anchored
- blocks fallback when an explicit anonymous actor intervenes
- separates attribution verbs from reaction verbs so `laughed`, `gasped`, etc. cannot steal a quote
- creates seven tightly scoped contextual provisional roles for explicit one-scene speakers
- expands safe narrator/displayed-text routing for embedded examples, labels, playlist titles and collective reveals
- keeps direct-address exclusion and two-speaker reasoning fail-closed
- exports nested Superman provenance as `superman.engineRelease` rather than a stale-looking generic `release`
- preserves zero-provider-call / zero-spend behavior

## Real Book One validation

Using the 56,852-word Book One DOCX:

- Superman: 98/100 PASS
- review queue: 281 (0.11.2) → 176 (0.11.3) → 138 (0.11.4) → **57 (0.11.5)**
- review chores removed versus original prep: **224 / 281 (~79.7%)**
- safely bound/resolved dialogue/displayed-text segments: **1,679**
- narrator-routed quoted/displayed/collective segments: **25**
- provisional roles: **11 total** (4 relational + 7 contextual)
- quick-confirm: **0**
- single-nearby-speaker: **5**
- context-review: **52**
- manual-identify: **0**
- pronunciation candidates: **34**
- provider calls: **0**

## Safety regression caught during build

An early experimental resolver was too eager around reaction verbs and generic anonymous actors. It could incorrectly attribute lines such as a stranger's post-performance comments or a reaction following `laughed/gasped` to a nearby core character. The final resolver uses a narrower speech-tag vocabulary and an anonymous-actor blocker. Known-danger Book One cases were re-audited before packaging; uncertain lines remain in review instead of being silently assigned.

## Next

0.12.0 — Series Continuity: promote approved Book One cast, pronunciations and performance identity into series-level continuity for Book Two.
