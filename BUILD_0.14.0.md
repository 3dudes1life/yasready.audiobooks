# YasReady Audiobooks 0.14.0 — External Book Superman

0.14.0 is the first generalization release after the SaaS boundary closed in 0.13.3. It runs an unrelated manuscript through YasReady Audiobooks without inheriting Book One identity truth and then exercises the downstream workflow with zero-spend synthetic asset references.

## What this build proves

- External manuscripts are analyzed with the Book One alias profile explicitly disabled.
- Book One title/character truth is treated as hostile contamination unless the external source itself contains that text.
- An optional baseline source hash can prove the external test is not accidentally the same manuscript again.
- A foreign Book One project, Audio Bible, character and voice assignment are seeded as isolation sentinels; external-project records must never reference them.
- The real external book/project is wired through Audio Bible, Casting Room, Audiobook Director, Production preflight, Money Guard preview, Review Studio, Continuity + QA, Mastering preflight and Distribution Brain.
- Production is never armed. No provider render, alignment, transcription, mastering, or distribution export occurs.
- Review/QA/Mastering/Distribution use synthetic **asset references only** to validate service wiring and ownership gates. They do not claim audio quality.
- A W3C dry-run distribution package is built in memory to prove package wiring without exporting files.

## New commands

```bash
node src/cli.js external-superman <unrelated.epub|docx|txt> --out <directory>
node src/cli.js external-superman <unrelated.epub|docx|txt> --baseline-hash <BOOK_ONE_SOURCE_HASH> --out <directory>
npm run external:fixture
```

The external report writes:

- `external-book-superman-report.json`
- `external-book-superman-report.md`

## Safety semantics

A PASS means the tested manuscript generalized through the 0.14.0 zero-spend boundary set. It does **not** mean synthesized audio quality has been validated. Real TTS, alignment/transcription, mastering and platform submission remain separately gated and paid.

## Validation

```bash
npm run check
npm test
npm run external:fixture
npm run casting:fixture
npm run boundary:fixture
npm run closure:fixture
npm run superman:fixture
npm run money-guard:fixture
```
