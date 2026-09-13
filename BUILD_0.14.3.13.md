# YasReady Audiobooks 0.14.3.13 — Production Plan & Budget

0.14.3.13 turns the human-approved Book One narrator lock into a deterministic, zero-spend production plan. It does **not** arm or generate full-book audio.

## Locked recipe carried forward

Production planning is allowed only from a valid PASSED Pace Ceiling finalization with an untampered narrator production lock. The plan carries forward the exact winning recipe:

- Ryan Kurk - Pleasant and Smooth
- Playful + Flirty base direction
- Deep Controlled Emotion
- stability `0.24`
- ElevenLabs native speed `1.20`
- effective speed `1.25`
- FFmpeg `atempo` multiplier `1.041667`
- pitch-preserving local post-processing

The narrator lock digest and manuscript source hash are both revalidated before a plan can be created.

## What the planner calculates

- chapter/scene workload from the real manuscript
- deterministic provider chunks using the existing model character limits
- per-chunk text and generation digests without embedding the manuscript text in the plan
- provider call count and provider character count
- chapter-by-chapter budget map
- local FFmpeg tempo task count
- chapter assembly workload
- planning runtime estimate
- retry reserve and protected production maximum
- output/storage structure
- QA checkpoints and resumability rules

## Money safety

- planning performs zero provider generation calls
- planning spend is `$0.00`
- no API key is required to create the plan
- provider credits are not fabricated from dollar pricing; live quota must be checked at the future production-arm gate
- the `PLAN-...` token is reference-only and cannot authorize spend
- production remains unarmed
- full-book generation remains unarmed

## Duplicate-spend protection planned before production

Every future paid unit has a deterministic `generationDigest`. Completed paid chunks must be reused. Local FFmpeg failures are safe to rerun without repeating TTS. Provider-success/local-storage-failure is explicitly `DO NOT RERUN PROVIDER` until the paid response is recovered or reconciled.

## New CLI

```bash
node src/cli.js production-plan <manuscript.epub|docx|txt> \
  --lock <pace-ceiling-finalization.json> \
  --out <DIR> \
  [--model eleven_v3] \
  [--rate-usd-per-1k 0.10] \
  [--retry-reserve 0.20] \
  [--chunk-safety 0.80] \
  [--chunk-cap N]
```

Outputs:

- `book-one-production-plan.json`
- `book-one-production-plan.md`
- `book-one-production-budget.csv`
- `book-one-production-manifest.json`
- `production-plan-confirmation.txt`

The correct stopping point after this release is: planned, priced, locked and safe; nothing expensive has begun.
