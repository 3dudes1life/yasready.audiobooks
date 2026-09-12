# 0.11.0 — Book One Superman

Book One Superman is the first full-novel stress harness for YasReady Audiobooks.

It is intentionally **zero-spend**. The harness imports a real EPUB/DOCX/TXT manuscript, runs manuscript structure and character-discovery checks, rehearses Production Engine chunking across the entire book, estimates TTS spend and regeneration reserve, verifies local FFmpeg readiness, and produces JSON + Markdown operator reports. It never arms paid production or calls a TTS provider.

## Run a real manuscript

```bash
node src/cli.js superman "/path/to/book.epub" --out "$HOME/Desktop/Book-One-Superman"
```

Or on macOS:

```bash
bash scripts/RUN_BOOK_ONE_SUPERMAN.command "/path/to/book.epub"
```

## Synthetic rehearsal

```bash
npm run superman:fixture
```

The synthetic rehearsal proves the harness itself without using copyrighted manuscript content.

## Release gates

- No duplicate chapter-content hashes.
- Long novels may not silently collapse into one chapter.
- Every chapter must produce renderable segments.
- Production chunking must stay under the selected model's safety cap.
- Dialogue attribution risk is surfaced before ensemble casting.
- Likely pronouns such as “He” and “She” are not allowed to become character candidates.
- TTS estimates include a configurable regeneration reserve and audition allowance.
- Provider calls performed by Superman are always zero.
- The report contains hashes/metrics, not the manuscript text.

## What happens after the report

A clean Superman report means the manuscript is safe to move into Audio Bible + Casting. It does **not** mean paid narration should start. The existing Casting, Director and Production Engine approval/budget gates remain authoritative.
