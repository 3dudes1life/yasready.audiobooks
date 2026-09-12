# External Book Superman

Release 0.14.0 answers one question: **does YasReady Audiobooks still behave correctly when the manuscript is not the book the system was developed around?**

## Isolation rules

External Book Superman disables the Book One alias profile, seeds a foreign Book One project as a contamination sentinel, and fails closed if unsupported Book One identity truth appears in the external report. A baseline source hash can also be supplied to prove the test manuscript is genuinely different from the baseline source.

## Zero-spend full-stack probe

The external manuscript's real project/book is used for Audio Bible, Casting, Director and Production preflight. Production is not armed. For downstream wiring, the harness creates synthetic asset **references** (never raw audio bytes) and exercises Review Studio approval, exact-run QA coverage, Mastering preflight, and W3C Distribution packaging.

The probe does not call TTS, alignment, transcription, mastering/FFmpeg transforms or distribution export. It is a wiring/ownership/generalization test, not an audio-quality test.

## Operator command

```bash
node src/cli.js external-superman "/path/to/unrelated-book.epub" --out "$HOME/Desktop/External-Book-Superman"
```

Optional baseline comparison:

```bash
node src/cli.js external-superman "/path/to/unrelated-book.epub" --baseline-hash "<book-one-source-hash>" --out "$HOME/Desktop/External-Book-Superman"
```

The command exits non-zero only for BLOCKED status. REVIEW means the pipeline generalized but the manuscript itself has findings that still require operator attention.
