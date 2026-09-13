# YasReady Audiobooks 0.14.3.16 — Quota-Aware Production Arm & Batch One

## Goal

Turn the successful 0.14.3.15 full-book preflight into a **bounded, quota-aware Batch One** without weakening the full-book safety gate. Batch One selects only complete sequential chapters that fit the live ElevenLabs character quota **plus retry headroom**, requires a new exact BATCH approval token, and blocks every chapter outside the arm.

This release also moves retailer formatting upstream so we do not finish 45 chapters and discover at the end that the masters were exported in the wrong format.

## Locked production chain

The exact approved Book One sound remains unchanged:

1. ElevenLabs / Ryan Kurk — Pleasant and Smooth
2. Playful + Flirty / Deep Controlled Emotion / stability 0.24
3. Provider speed 1.20
4. FFmpeg pace step to effective 1.25
5. Warm + Slightly Deeper local finish (-0.5 semitone + locked EQ/duration compensation)
6. Chapter assembly
7. Lossless archive + retailer technical derivatives
8. Local technical QA

No next batch is auto-armed and full-book generation remains OFF.

## Quota-aware arm

The arm performs read-only provider and local preflight work. It:

- verifies the production-plan, recipe and full-book-preflight digests;
- refuses to bypass any full-book blocker other than insufficient full-book provider quota;
- rechecks live provider quota;
- verifies FFmpeg and local storage;
- reuses verified Chapter One paid provider audio when the original pilot is still present;
- selects the largest safe prefix of **whole chapters**, capped at 10 chapters per batch, whose new TTS characters plus 20% retry reserve fit current quota;
- calculates exact provider calls, characters, retry reserve and protected max;
- produces a `BATCH-...` token that authorizes only that immutable scope.

The previous `PREFLIGHT-...` token cannot authorize spend.

## Duplicate-spend protection

The Book One helper refuses to proceed if the paid Chapter One pilot evidence cannot be found. When available, its provider base chunks are digest-verified and imported into Batch One for local reprocessing rather than purchased again.

Paid batch chunks are stateful and resumable. A local tempo or local voice-finish failure is safe to rerun without calling ElevenLabs again. Unknown provider outcomes remain `DO NOT RERUN PROVIDER` until reconciled.

## Retailer-safe chapter masters

### Canonical archive master

Each completed chapter receives a lossless **44.1 kHz / 24-bit WAV** archival master. This is the durable source master used for current or future retailer encodes.

### ACX / Audible technical derivative

Current ACX guidance reviewed 2026-09-13 requires, among other things:

- one chapter or section per file;
- MP3 at 192 kbps or higher, Constant Bit Rate;
- 44.1 kHz;
- consistent mono/stereo across the title;
- RMS between -23 dB and -18 dB;
- peaks below -3 dB;
- noise floor below -60 dB RMS;
- 1–5 seconds room tone at beginning/end;
- each file <=120 minutes;
- separate opening and closing credits;
- a retail sample <=5 minutes.

YasReady Batch One emits conservative **192 kbps CBR / 44.1 kHz MP3** chapter files and QA-checks them against the existing ACX mastering profile, now also enforcing the 120-minute section ceiling.

**Eligibility guard:** ACX currently states submitted audiobooks must be human-narrated unless otherwise authorized and that unauthorized TTS/AI recordings are prohibited. Therefore the files may be technically compliant while the title is still **not eligible** for ACX/Audible. YasReady explicitly records `BLOCKED_UNLESS_ACX_AUDIBLE_EXPLICITLY_AUTHORIZES_DIGITAL_NARRATION` and never calls this retailer package submission-ready unless explicit ACX/Audible authorization evidence is recorded.

Source: https://help.acx.com/s/article/what-are-the-acx-audio-submission-requirements

### Spotify for Authors direct upload

Current Spotify guidance accepts:

- MP3, WAV or FLAC;
- MP3 at 192 kbps or higher;
- WAV at 44.1 kHz / 16-bit;
- chapter files <=2 hours;
- consistent mono/stereo;
- clear chapter titles;
- opening/front matter and closing/back matter;
- a sample file;
- square PNG/JPEG cover art (3000×3000 recommended);
- required direct-upload metadata including title, author, narrator, language, a unique audiobook ISBN-13, BISAC, territories and pricing.

Spotify explicitly accepts **digital voice narration from providers including ElevenLabs**, provided the uploader selects the digital voice disclosure option. YasReady separately QA-checks the conservative ACX-format MP3 against the Spotify profile and records the disclosure requirement.

Sources:
- https://support.spotify.com/us/authors/article/uploading-audiobooks/
- https://support.spotify.com/us/authors/article/troubleshooting-audiobook-alerts/
- https://support.spotify.com/us/authors/article/digital-voice-narration/

### Apple Books

Apple Books says audiobook distribution is handled through **preferred partners**. Apple/partner-specific delivery rules therefore remain authoritative. YasReady does not fabricate a universal direct-upload Apple audio spec.

Batch One prepares the lossless 44.1 kHz / 24-bit WAV as a **preferred-partner source handoff** and records `PREFERRED_PARTNER_AND_DIGITAL_NARRATION_POLICY_VALIDATION_REQUIRED`. The final Apple package is blocked until a partner route is selected and that route confirms current audio, metadata and digital-narration eligibility requirements.

Source: https://itunespartner.apple.com/books/support/45-sell-audiobooks-apple-books

## Final-package boundary

Batch chapter masters are **not** a complete retailer submission. Final Distribution Brain packaging must still add/validate:

- opening credits;
- closing credits;
- retail/sample audio as required;
- final cover art;
- title/author/narrator/language and retailer metadata;
- ISBN/price/territory fields when required by the selected route;
- digital narration disclosure or explicit platform/partner authorization evidence when required;
- platform-specific freshness checks.

This is deliberate: production creates durable, correct masters now, while final packaging remains target-aware and current at release time.

## Build validation before handoff

The packaged update was locally validated for:

- installer, helper, patcher, service, CLI and test syntax;
- **19/19** isolated quota-aware batch regression cases in a reconstructed dependency harness;
- bounded whole-chapter selection including spoken-heading quota cost;
- exact BATCH-token enforcement and PREFLIGHT-token rejection;
- live-quota retry headroom recheck before paid work;
- verified paid-pilot reuse / duplicate-spend refusal;
- local-processing resume without repaying provider TTS;
- 5xx/timeout-style provider uncertainty treated as **DO NOT RERUN PROVIDER** rather than automatically retrying;
- retailer chapter derivatives and final-package boundary assertions;
- package checksum and ZIP integrity.

The installer intentionally runs the complete repository test suite on the user's Mac before it can commit or push. A full-suite failure triggers rollback and means the release is **not live**.

## Fixed installer regression pass

The first installer candidate exposed five legacy distribution-fixture regressions after ACX's required retail-sample gate became fail-closed. The fixed package updates only the affected fixtures: ACX fixture projects now include a measured <=5-minute sample and the export materializer includes the sample asset. It also aligns Spotify ISBN handling with Spotify's specific current ISBN guidance: ISBN is optional for direct Spotify for Authors publishing, but if supplied it must validate and must not reuse another edition's ISBN.

FIXED2 packaging note: corrected the isolated Spotify distribution-contract regression to match the release policy: BISAC/territories/price remain required for this YasReady contract, while audiobook ISBN-13 is optional and validated only when supplied. No production runtime behavior was relaxed.
