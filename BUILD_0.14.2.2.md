# YasReady Audiobooks 0.14.2.2 — Anonymous Catalog Pagination & Auth UX

The first real 0.14.2.1 run proved a second ElevenLabs anonymous-catalog rule:
logged-out callers may browse the shared catalog, but requests for more than 3 voices are rejected.

0.14.2.2 handles that provider behavior without weakening Book One casting safety.

## Provider behavior

When no `ELEVENLABS_API_KEY` is present:

1. YasReady tries the preferred filtered request.
2. If ElevenLabs rejects logged-out filters, YasReady tries the public catalog.
3. If ElevenLabs rejects a public page larger than 3 voices, YasReady automatically retries with `page_size=3`.
4. Subsequent anonymous pages go directly to the public 3-voice mode instead of repeatedly triggering the same auth errors.
5. YasReady paginates enough public pages to try to fill the Wave 1 shortlist, while deduplicating voices and stopping on no-growth/end-of-catalog conditions.

The existing local Book One safety policy still applies to every anonymously returned voice:
English-capable, professional/high-quality, >=180-day notice, no custom rate, and no live moderation.

## Honest accounting

Catalog metadata HTTP requests are counted accurately, including fallback/retry calls.
They remain read-only catalog traffic, not paid TTS provider calls.

## Operator UX

- Adds `--anonymous-pages N` for the anonymous scan ceiling. Default: 30; maximum: 50.
- If anonymous browsing cannot fill the shortlist, YasReady recommends adding `ELEVENLABS_API_KEY` for broader filtered discovery instead of pretending the shortlist is complete.
- API-key authentication remains optional for this attempt; no secret is stored in GitHub or output artifacts.

## Spend boundary

Still zero:
- TTS generation
- audition rendering
- cast locks
- production rendering
