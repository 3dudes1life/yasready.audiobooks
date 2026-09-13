# YasReady Audiobooks 0.14.3.1 — Character Cultural Fit Hardening

0.14.3.1 refines Book One Wave 1 casting after the real ElevenLabs Review Board exposed an important character-fit gap.

## Juan Delgado

Juan is canonically Latino. YasReady now treats that as an explicit character casting constraint without stereotyping how a Latino American man must sound.

- Contemporary American / neutral delivery remains welcome.
- Explicit provider catalog metadata such as Latino, Latin American, Hispanic, Mexican-American, Chicano, Puerto Rican, Cuban-American, Colombian-American, etc. satisfies Juan's cultural-fit audition gate.
- Spanish or bilingual metadata helps, but Spanish alone does not prove Latino identity and therefore does not satisfy the hard audition gate.
- A voice with no explicit Latino/Latin-American/Hispanic signal may remain visible as an ALTERNATE, but YasReady cannot auto-recommend it as AUDITION for Juan.
- YasReady does not infer race or ethnicity from a voice's sound, name, or preview.

## Christopher Lancaster

Christopher is canonically Asian American and from the San Francisco Bay Area.

- His audible target remains contemporary American / neutral / California / Bay Area.
- Asian-American metadata is a positive signal when the provider explicitly supplies it, but it is never required.
- Bay Area, San Francisco, California, Californian, and West Coast metadata receive a positive regional-fit boost.
- YasReady does not require or reward a stereotyped “Asian accent.”
- YasReady does not infer Asian identity from a voice's sound or name.

## Catalog discovery

Authenticated ElevenLabs discovery now performs zero-spend supplemental metadata searches for culturally relevant Book One signals after the general catalog pass. Results are deduplicated and must still satisfy the existing professional-quality, English-capable, notice-period, custom-rate, and moderation safety policy.

These are metadata catalog calls only. They do not invoke TTS or spend generation credits.

## Scarce-candidate protection

Roles with a hard cultural audition requirement are allocated first when YasReady builds unique core-role shortlists. This prevents a scarce culturally fitting Juan candidate from being consumed by Narrator or another role before Juan is evaluated.

## Casting Review Board

The local Review Board now shows a Cultural fit score/context when applicable and explains that cultural fit is based only on explicit provider catalog metadata.

## Spend boundary

Paid provider calls: 0
TTS generation calls: 0
Audition rendering armed: NO
Production armed: NO
