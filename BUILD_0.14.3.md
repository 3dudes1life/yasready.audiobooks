# YasReady Audiobooks 0.14.3 — Casting Fit & Audition Script Hardening

0.14.3 hardens the real Book One casting workflow after authenticated ElevenLabs discovery exposed two real-world quality gaps: print-only front matter could leak into Narrator audition material, and safe-but-poor character matches could rank too highly because generic catalog safety outweighed casting fit.

## Casting-fit hardening

- Casting fit now outweighs generic series-safety once a voice has already passed the discovery safety policy.
- Book One creative-intent profiles now include preferred gender, adult age band, practical use cases and soft accent guidance.
- Gender mismatch is a hard casting-fit mismatch for the current Book One creative defaults.
- Obvious age/use-case/accent stretches are penalized and surfaced as operator concerns rather than silently ranked as ideal.
- A candidate is labeled `AUDITION` only when it clears the role-fit floor and has no hard mismatch.
- Poor-fit candidates can remain visible as `PASS`/`ALTERNATE` for operator context but are excluded from the recommended audition plan.
- Recommended audition cost now counts only candidates actually labeled `AUDITION`.

## Cross-character distinctiveness

- Exact voice reuse across core roles remains blocked.
- Top-pick selection now applies a small metadata-distinctiveness adjustment so equally strong voices do not default to nearly identical catalog profiles.
- Similarity signatures include structured metadata plus meaningful descriptive traits.
- Acoustic distinctiveness is still never claimed until humans listen.

## Audition-script hardening

Narrator scripts now explicitly exclude print-only/front-matter material such as:

- copyright/legal notices
- all-rights-reserved text
- ISBN/publisher/edition metadata
- title/front-matter/contents/dedication sections

The opening Narrator audition therefore comes from real narrative prose, not the copyright page.

## Local Casting Review Board

Every `casting-discover --out ...` run now also writes:

- `casting-review.html`

The review board is a self-contained local operator UI with:

- embedded ElevenLabs preview players
- role-fit, safety and stretch warnings
- canonical audition scripts
- Keep / Maybe / Pass controls
- local autosave in the browser
- `Export Audition Choices` to produce `casting-review-decisions.json`
- zero provider calls and zero paid generation

The HTML contains no API key and is intended to remain local with the other sensitive Book One casting artifacts.

## Spend boundary

0.14.3 still cannot arm or render auditions. Money Guard remains mandatory before any future paid audition action.
