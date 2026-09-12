# YasReady Audiobooks 0.3.0 — Audio Bible

0.3.0 creates the canonical continuity layer used by casting, directing and generation.

## Added

- Series-level Audio Bibles inherited by individual books
- Canonical character identities, aliases and role/performance profiles
- Alias collision protection across inherited casts
- Character relationship records
- Pronunciation rules with book-over-series override precedence
- Conservative manuscript speaker resolution (exact canonical/alias matches only)
- Auditable segment-to-character speaker bindings
- Production-relevant Bible revisions and deterministic digests
- Continuity reports for inherited/local characters and unresolved dialogue

## Safety rules

- Parser guesses never become canonical characters automatically.
- Unknown speakers remain unresolved.
- Book bibles may inherit only from a series bible in the same project.
- Production-impacting Bible changes alter the digest so later audio caches can invalidate safely.
