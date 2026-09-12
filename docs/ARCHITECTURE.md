# Architecture — 0.1.0

## Core hierarchy

`Book -> Chapter -> Scene -> Segment -> Take -> Master`

A **Segment** is the smallest production unit intended for selective regeneration. A **Take** records one rendered attempt for a segment. A **Master** is assembled only from explicitly approved takes.

## Persistent entities

- Project
- Book
- Chapter
- Scene
- Segment
- Character
- VoiceAssignment
- Pronunciation
- Provider
- GenerationRequest
- CostEvent
- Approval
- AudioAsset
- AlignmentRecord
- Master

Every entity carries an id, timestamps and a project id where applicable.

## Provider boundary

Audio engines must implement `AudioProvider`. No domain service may contain provider-specific HTTP logic.

This allows ElevenLabs, OpenAI or future engines to be swapped or compared without rewriting production state.

## Money safety

Every generation request must have a deterministic render fingerprint based on canonical text, provider, model, voice, settings, pronunciation dictionary version and director instructions.

Identical fingerprints are reusable. The production engine should never pay twice for identical work unless the caller explicitly requests a fresh take.

All variable provider spending is recorded as append-only `CostEvent` entries.

## Approval safety

Approved production units are locked. Changes require an explicit unlock event. Later builds must not silently regenerate approved segments or masters.

## Storage safety

Git is never used for customer manuscripts or generated audio. `AudioAsset` stores metadata and an opaque storage locator only.
