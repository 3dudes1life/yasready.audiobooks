# YasReady Audiobooks Review Studio — 0.7.0

Review Studio is the human approval gate between generated audio and mastering.

## Core rules

1. Production audio enters Review Studio only after a `production_job` is `ready` and has an asset reference.
2. Raw audio bytes never live in Review Studio records; takes point to private storage assets.
3. Each chapter can contain labeled takes (A/B/C…) and synchronized canonical regions.
4. The canonical manuscript text is hashed per region. Timing can vary by take; text cannot silently drift.
5. A region is approved by selecting one synchronized take.
6. Rejections require a reason and may create a regeneration request, but Review Studio never renders audio itself.
7. Chapter approval requires every region to have an approved take.
8. Approved chapters lock their selected regions/takes. Revision requires an audited unlock reason.
9. A review session cannot be finalized until every chapter review is approved.

## Waveform + transcript model

`review_take` stores optional `waveformLocator` and `transcriptLocator` references. `review_timing` maps canonical regions to start/end milliseconds for each take. 0.8.0 will populate these mappings automatically from alignment/transcription QA; 0.7.0 establishes the review state model and validation gates.

## Regeneration

A rejection creates `regeneration_request(status=requested)`. `queueRegeneration()` delegates to Production Engine's reserve-aware `requestRegeneration()` method. It does not call the TTS provider or spend money by itself.
