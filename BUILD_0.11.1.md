# YasReady Audiobooks 0.11.1 — Book One Superman Cleanup

This cleanup release is driven by the first real Book One Superman run of *Tres Amigos, Una Vida*.

## Fixed

- Context-aware dialogue attribution now uses nearby action beats, speech tags, continuation cues and conservative two-person turn inference.
- Low-confidence inferred dialogue remains explicitly marked for human review; it is not silently treated as canonical truth.
- Book One alias grouping merges Michael/Rawlins/Micheal, Juan/Delgado, and Christopher/Chris for roster review without rewriting manuscript text.
- Kindle Create DOCX front matter is detected as `Front Matter` when title/copyright/TOC markers precede the first real chapter.
- Print-only front matter is excluded from narration cost rehearsal while remaining preserved in the source manuscript analysis.
- Missing author metadata can be inferred from a front-matter `by ...` line.
- Book One Superman defaults the canonical title to `Tres Amigos, Una Vida – A Throuple Love Story`, with CLI/script override support.
- The run script now expands pasted `~/...` paths correctly and supports `--title`, `--author`, `--model`, and `--out` flags.
- Report UX now separates source sections from narrative chapters and shows high-confidence, inferred-review, and unresolved dialogue counts.

## Real Book One validation

Using the Kindle Create `book_1.docx` supplied during development:

- 56,852 words
- 44 narrative chapters + 1 front-matter section
- readiness improved from 73/100 to 98/100
- unresolved dialogue reduced from 82% to about 13%
- Book One roster collapsed to 12 plausible candidates after alias/artifact cleanup
- title resolved to `Tres Amigos, Una Vida – A Throuple Love Story`
- author inferred as `D.C.W.`
- zero paid provider calls

The remaining dialogue gap is intentionally a low-severity Audio Bible spot-check instead of a reason to make the operator manually repair 1,419 lines.
