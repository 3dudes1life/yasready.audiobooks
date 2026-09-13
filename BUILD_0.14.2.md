# YasReady Audiobooks 0.14.2 — Book One Casting Candidate Discovery

0.14.2 turns the locked 0.14.1 Casting Launch artifact into a real zero-spend candidate discovery workflow for Book One.

## What it adds

- Searches the ElevenLabs shared/professional voice catalog without rendering audio.
- Builds 1–8 unique candidates per Wave 1 role (default 6): Narrator, Juan Delgado, Michael Rawlins and Christopher Lancaster.
- Uses the existing Casting Room series-safety model as part of ranking.
- Adds role-fit metadata ranking with explicit Book One creative defaults; those defaults are not treated as canonical character biography.
- Hard-blocks exact voice reuse across Wave 1 shortlists.
- Adds metadata-similarity warnings between top choices while explicitly refusing to claim acoustic similarity before humans listen.
- Optionally reruns the exact Book One manuscript through the zero-spend locked Audio Bible intelligence so audition scripts come from canonical narration/dialogue and the source hash must match the Casting Launch.
- Generates recommended top-3 audition and full-shortlist cost estimates without rendering anything.
- Keeps `ARM AUDITIONS` unavailable in this build: paid provider calls, TTS generation, cast locks and production all remain unarmed.

## Real Book One command

```bash
node src/cli.js casting-discover \
  "$HOME/Desktop/YasReady-Book-One-Casting-Launch/casting-launch.json" \
  --prep "$HOME/Desktop/YasReady-Book-One-Audio-Bible-Prep-0.14.1/book-one-audio-bible-prep.json" \
  --manuscript "/path/to/book_1.docx" \
  --out "$HOME/Desktop/YasReady-Book-One-Casting-Discovery"
```

The shared catalog discovery call is non-generation metadata traffic. The artifact reports catalog calls separately from paid/generation calls so zero-spend truth is not mislabeled as zero network activity.

## Outputs

- `casting-candidate-discovery.json`
- `casting-candidate-discovery.md`
- `casting-shortlist.csv`
- `audition-scripts.csv`

The output folder can contain manuscript-derived audition excerpts and must stay out of GitHub.

## Validation

The installer runs focused 0.14.2 tests, the full regression suite, syntax checks, Casting Scope Integrity, Casting Launch, SaaS Boundary, Final Boundary Closure, Book One Superman, External Book Superman and Money Guard before commit/push.
