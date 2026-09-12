# YasReady Audiobooks 0.11.3 — Audio Bible Intelligence Cleanup

Baseline: **0.11.2 — Book One Audio Bible Prep**

## Why this release exists

The first real Book One Audio Bible Prep run correctly isolated 281 dialogue lines for review, but the operator pack exposed avoidable work: some quoted labels/emphasis were being treated as speech, unnamed relational speakers were not represented in the Audio Bible, self-identifying lines still needed review, and the pronunciation queue was broader than necessary.

0.11.3 reduces that work without weakening the fail-closed rule. Ambiguous lines still remain human decisions.

## Intelligence cleanup

- routes supported quoted/displayed text to Narrator rather than inventing speakers
- resolves explicit self-identification (for example, `I'm Christopher` / `Name's Delgado`)
- uses explicit after-speech tags and preceding speaker leads when evidence is strong
- applies conservative direct-address exclusion only when one nearby alternative speaker is uniquely supported
- creates provisional relational roles only from explicit contextual evidence
- Book One provisional roles currently supported: Michael's Mother, Michael's Brother, Realtor, Landlord
- records intelligence source, confidence, evidence and classification for every automatic resolution
- keeps provisional roles visibly marked instead of silently treating them as final canonical cast

## Pronunciation cleanup

- replaces broad proper-noun harvesting with a focused Book One watchlist
- retains title/byline and actual named-character review candidates
- surfaces language switches such as `Te amo`
- excludes obvious/noisy terms that do not need explicit author pronunciation control
- never fills `spoken_as` automatically

## Safety

- zero provider calls
- paid generation remains disarmed
- manuscript excerpts remain local to the operator pack
- unresolved speaker decisions remain blank
- canonical manuscript text is never rewritten by the intelligence layer

## Real Book One validation

Against the same 56,852-word Book One DOCX used for 0.11.2:

- Superman gate: **98/100 PASS**
- prior review queue: **281** lines
- 0.11.3 preview review queue: **176** lines
- avoidable review chores removed: **105**
- safely resolved/bound: **1,560** dialogue/displayed-text segments
- quoted/displayed text routed to Narrator: **11** segments
- provisional roles created: **4**
- focused pronunciation candidates: **34**
- provider calls: **0**

## Tests

- full historical regression suite passes
- dedicated 0.11.3 tests cover quoted/displayed text classification, self-identification, provisional relational speakers, ambiguity preservation and no-guess pronunciation behavior
- syntax gate includes the new intelligence module
