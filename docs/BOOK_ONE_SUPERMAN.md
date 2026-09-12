# Book One Superman

Book One Superman is a zero-spend, full-manuscript readiness gate for YasReady Audiobooks.

## 0.11.1 cleanup behavior

The cleanup pass adds contextual dialogue attribution, Book One alias consolidation, front-matter separation, byline inference, and metadata/run-script UX fixes revealed by the first real *Tres Amigos, Una Vida* DOCX run.

Dialogue attribution now distinguishes three levels:

- **High confidence** — explicit tags or strong local context. Eligible for normal Audio Bible review.
- **Contextually inferred / human review** — useful conversational inference below the automatic binding confidence threshold.
- **Unresolved** — left unassigned rather than guessed.

The Book One roster groups known aliases for review only. The manuscript itself is never rewritten. Current Book One groupings are Michael Rawlins (`Michael`, `Rawlins`, `Micheal`, `Then Michael`), Juan Delgado (`Juan`, `Delgado`), and Christopher Lancaster (`Christopher`, `Chris`, `Lancaster`).

Print-only `Front Matter` is preserved in source analysis but excluded from narration-cost rehearsal. This keeps copyright pages and tables of contents from inflating audiobook generation cost while leaving the source untouched.

## Run

```bash
bash scripts/RUN_BOOK_ONE_SUPERMAN.command "/full/path/to/book_1.docx"
```

Optional overrides:

```bash
bash scripts/RUN_BOOK_ONE_SUPERMAN.command "/full/path/to/book_1.docx" \
  --title "Tres Amigos, Una Vida – A Throuple Love Story" \
  --author "D.C.W." \
  --model eleven_multilingual_v2
```

The script accepts pasted `~/...` paths and writes JSON + Markdown reports to the Desktop by default.

Book One Superman performs no paid voice generation.
