# YasReady Audiobooks — Continuity + QA Brain (0.8.0)

0.8.0 adds machine-assisted audiobook QA without allowing the machine to silently approve its own work.

## QA pipeline

For each Review Studio take:

1. Load the private audio asset through an injected `assetLoader`.
2. Forced-align the canonical manuscript text to the rendered audio.
3. Independently transcribe the audio with Scribe v2.
4. Compare the unbiased transcript back to canonical text.
5. Flag missing words, substitutions, extra words, adjacent duplicate phrases, pronunciation risks, alignment loss, timing anomalies, long silences, and low-confidence transcription regions.
6. Require a human resolution/waiver for blocking findings.
7. Lock a QA run only when every report has no unresolved high/critical finding.

## Important anti-self-deception rule

The primary QA transcription does **not** use pronunciation keyterm bias by default. A pronunciation dictionary can make transcription more likely to output the expected spelling and therefore mask a questionable render. Keyterms can be enabled only as an explicit secondary diagnostic.

## Approval states

- `pass` — no open findings.
- `warning` — only medium/low findings remain.
- `review_required` — a high/critical finding is still open.
- `approved` — the QA run was human-reviewed, blocking findings resolved/waived, and the run was locked.

## Provider boundary

The ElevenLabs provider now implements:

- `align()` → `POST /v1/forced-alignment`
- `transcribe()` → `POST /v1/speech-to-text` using `scribe_v2`

All real network calls remain behind the provider interface. Tests use fake providers/fetch and make zero paid calls.

## Privacy/storage

QA entities store reports, findings, transcript text, hashes/metadata and references. Raw audiobook bytes remain outside the application records and are supplied transiently by `assetLoader`.
