# YasReady Audiobooks 0.11.7 — Speaker Truth Closure

0.11.7 is the final Book One speaker-truth hardening pass before casting. It adds a high-authority verifier that can correct a confident parser candidate when the manuscript supplies stronger same-paragraph or attribution evidence, while protecting stronger semantic classifications from being overwritten.

## What changed

- Speaker-truth confirmations now become authoritative when explicit prose evidence agrees.
- Confident-but-wrong parser candidates can be corrected by explicit attribution.
- Anonymous speakers backfilled by later self-identification cannot be stolen by generic he/she proximity.
- Narrator, displayed-text, media-title and collective classifications are protected from speaker reclassification.
- Split song/media titles are routed to Narrator instead of generating fake characters.
- One-mention names require actual spoken evidence before entering the permanent Audio Bible; real one-line speakers remain supported.
- Permanent Book One roles remain book-scoped; one-scene extras remain scene-scoped with no reusable series key.
- Scene-local naming remains stable for the New Year’s couple and other extras.
- Prep schema advances to 6 and release markers to 0.11.7.

## Book One Superman result

The real 56,852-word Book One zero-spend run closes the 281-line original review candidate set to **0 remaining speaker-review rows**, with **15 permanent roles**, **8 scene-local extras**, **1 explicit collective binding**, and no provider calls. The 48 residual 0.11.6 rows were separately truth-audited against manuscript context before packaging.

No manuscript excerpts, provider credentials, or generated audio are committed.
