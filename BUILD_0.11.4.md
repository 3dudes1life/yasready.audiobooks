# YasReady Audiobooks 0.11.4 — Review Queue Closure

Baseline: **0.11.3 — Audio Bible Intelligence Cleanup**

## Why this release exists

The real 0.11.3 Book One pack reduced the targeted dialogue queue from 281 to 176 lines, but a safety audit found more operator work that could be removed without guessing: quoted signs/news labels/text-message fragments still leaked into speaker review, direct-address evidence could sometimes nominate the addressee as the speaker, and some low-confidence alternating-pair guesses were still presented too optimistically.

0.11.4 closes those avoidable review paths while making speaker inference **more conservative**, not more aggressive.

## Review Queue Closure

- routes remaining supported signs, labels, news terms, text-message fragments, hypothetical quotes, performance titles and collective quoted speech to Narrator/displayed-text handling
- strengthens vocative/addressee exclusion, including Book One nicknames such as Cowboy, Juanito and Bay Area
- ensures explicit relational-role evidence wins before direct-address guessing
- adds conservative pronoun-continuation resolution only when the immediate local antecedent is supported
- adds conservative two-speaker turn resolution using stable-scene, sandwich and reaction evidence
- fails closed when an anonymous third speaker is introduced
- prevents alternating-pair guesses from ever being labeled `quick-confirm`
- distinguishes intelligence **detected** from intelligence **actually applied**
- uses actual narrator-routed bindings as the single source of truth for quoted/displayed-text accounting

## Safety

- zero provider calls
- paid generation remains disarmed
- manuscript excerpts remain local to the operator pack and are never written into the release patch
- ambiguous pronoun and multi-party dialogue remains in human review
- automatic intelligence may override an existing candidate only when stronger contradictory evidence is explicit and auditable
- canonical manuscript text is never rewritten

## Real Book One validation

Against the same 56,852-word Book One DOCX used throughout the 0.11 series:

- Superman gate: **98/100 PASS**
- original 0.11.2 review queue: **281** lines
- 0.11.3 review queue: **176** lines
- 0.11.4 review queue: **138** lines
- total avoidable review chores removed versus 0.11.2: **143**
- safely resolved/bound: **1,598** dialogue/displayed-text segments
- quoted/displayed-text/collective speech routed to Narrator: **21** segments
- provisional relational roles: **4**
- `quick-confirm` rows remaining: **0**
- single-nearby-speaker review: **26**
- context review: **109**
- true manual identify: **3**
- focused pronunciation candidates: **34**
- provider calls: **0**

The audited queue no longer contains the known false-dialogue examples from the 0.11.3 pack, and `Te amo, Michael.` is safely resolved to Juan rather than the addressee.

## Tests

- **167/167** regression tests pass
- syntax gate passes
- whole-book Superman fixture passes at Book-One scale with zero spend
- dedicated 0.11.4 tests cover quoted-text closure, contradictory addressee correction, relational-role precedence, anonymous-third-speaker fail-closed behavior, safe queue priority and applied-vs-detected accounting
