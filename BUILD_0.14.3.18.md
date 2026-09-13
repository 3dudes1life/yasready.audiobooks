# YasReady Audiobooks 0.14.3.18 — Cinematic Naturalism Lock & Batch One Rebuild

## Goal

Lock the human-selected **A / original Cinematic Naturalism** performance profile and rebuild the first ten narrative chapters as a new, preserved production revision before any Chapter 11+ generation is allowed.

This release is cumulative from the verified LIVE 0.14.3.16 baseline because 0.14.3.17 never passed its install gate. It therefore includes the 0.14.3.17 Direct Edition foundation, production console and read-only next-batch readiness work as well as the new cinematic rebuild system.

## Human decision locked

The A/B result is encoded as production truth:

- **A — original Cinematic Naturalism: SELECTED**
- **B — Cinematic +2: REJECTED**
- no +2 escalation may enter Book One production
- narrator remains Ryan Kurk — Pleasant and Smooth
- Playful + Flirty remains the base direction
- Deep Controlled Emotion remains the emotional profile
- provider speed remains 1.20
- effective finished pace remains 1.25
- Warm + Slightly Deeper remains the local finish

The missing layer is scene-aware performance, not a narrator change.

## Cinematic Naturalism A rules

The lock is deterministic and restrained. It uses only canonical manuscript text plus immediate neighboring segments as evidence. It may add safe ElevenLabs v3 performance cues such as `playfully`, `softly`, `cautiously`, `whispers`, `angry` and `slowly` when the manuscript earns them.

Safety limits:

- maximum 7 cues per scene;
- at least one untouched segment between cues;
- maximum 2 uses of the same cue per scene;
- maximum 2 narration cues per scene;
- character differentiation is delivery/timing/subtext, not impersonation;
- canonical manuscript words are immutable;
- no inferred identity from audio;
- no extra voices or sound effects;
- Cinematic +2 is explicitly disabled.

## Batch One rebuild, never overwrite

The completed 0.14.3.16 Batch One remains historical production evidence and is digest-verified before a rebuild arm can be created.

Cinematic outputs go to a separate root:

`~/Desktop/YasReady-Book-One-Cinematic-Rebuild/batch-001-cinematic-r1`

The rebuild service refuses any output root that overlaps the original Batch One directory.

Each rebuilt chapter receives:

- provider source audio using the locked Cinematic Naturalism A direction;
- the locked 1.041667x FFmpeg tempo step to effective 1.25;
- the locked Warm + Slightly Deeper finish;
- lossless archive WAV;
- conservative chapter MP3;
- Spotify/direct MP3 copies;
- Apple preferred-partner WAV source;
- technical QA and cryptographic digests.

## Quota-aware rebuild

The arm is **zero TTS / $0.00**. It verifies:

- original Batch One arm/result integrity;
- original archive + MP3 file digests;
- manuscript source hash;
- production-plan and recipe digests;
- exact Cinematic Naturalism A lock;
- FFmpeg health;
- live ElevenLabs quota;
- local storage.

It then selects the largest safe sequential prefix of **whole chapters from Chapters 1–10** that fits live provider quota plus the existing 20% retry reserve. If current quota cannot safely fit all ten, the rebuild is split into multiple exact scopes without ever moving on to Chapter 11.

Each paid scope gets a new exact `CINEMATIC-...` authorization token and protected dollar maximum. The token authorizes only the immutable chapters in that arm.

## Resume / duplicate-spend protection

Paid cinematic chunks are stateful and resumable:

- completed provider audio is never silently repurchased;
- missing or digest-mismatched paid source audio becomes **DO NOT RERUN PROVIDER**;
- unknown provider outcomes become **DO NOT RERUN PROVIDER**;
- deterministic client failures may be explicitly retried;
- local tempo/voice-finish failures are safe local reruns;
- an unfinished arm must be reused rather than silently replaced by a new token.

## Review gate

Every successful scope rebuilds the review board:

`cinematic-rebuild-review.html`

The page shows the chapters in order and auto-advances during playback. Once all ten are technically green it becomes **READY_FOR_HUMAN_TEN_CHAPTER_REVIEW**.

**Chapter 11 remains OFF even after all ten files exist.** The next production milestone is a human straight-through listen of the ten cinematic chapters. A later explicit approval gate is required before normal production may continue.

## Persistent ElevenLabs key

YasReady now reads the local key at:

`~/.config/yasready-audiobooks/elevenlabs.key`

The cinematic helper prompts only if the environment and saved file are both empty, then saves the key with owner-only permissions. Provider CLIs also load the saved key automatically.

## Direct Edition remains first-class

The cumulative release preserves the business rule:

> **Retailers give us reach. Direct gives us the relationship.**

The Direct Edition foundation and ownership/entitlement contract from the planned 0.14.3.17 release are included here so that work is not lost.

## Validation before handoff

Package-side validation completed for:

- Node syntax on the new cinematic service, CLI and tests;
- shell syntax on installer and helpers;
- Python patcher compilation;
- **10/10** isolated Cinematic Naturalism / rebuild / persistent-key tests;
- deterministic A-lock behavior;
- canonical manuscript preservation;
- whole-chapter quota selection;
- zero-spend arm semantics;
- original Batch One preservation;
- exact CINEMATIC-token enforcement;
- ten-chapter separate-revision completion;
- Chapter 11 / next batch / full-book gates remaining OFF.

The installer runs the complete real repository regression suite on the user's Mac after patching. It commits and pushes only if every test passes. Any failure triggers a hard rollback to the verified 0.14.3.16 baseline and nothing is pushed.
