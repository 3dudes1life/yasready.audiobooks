# 0.10.0 UX + Bug Superman Pass

This pass reviewed the standalone workflow from manuscript intake through distribution.

## UX principles enforced

- Every major stage now has a plain-English operator action.
- Distribution preflight distinguishes **blockers** from **warnings**.
- The dashboard always surfaces one `nextAction`; it does not dump raw state on the operator.
- Platform-specific jargon stays inside profiles; authors see outcomes such as “Confirm rights” or “Add cover art.”
- A package can be technically ready while still showing a platform-policy gate.

## Bugs / failure modes closed

- Prevent distribution from an unlocked or unfinished master.
- Prevent duplicate output filenames from entering a retailer package.
- Detect mixed mono/stereo files before submission.
- Detect missing opening/closing credits for destinations that require them.
- Validate optional ISBNs and reject accidental reuse of the print/ebook ISBN when supplied.
- Require an explicit digital-narration disclosure for Spotify.
- Require a manual platform-eligibility confirmation for ACX when the audiobook uses digital narration.
- Warn when platform rules have gone stale instead of silently using old requirements.
- Never store raw cover/audio/package bytes in the in-memory production domain.
- Export packages through materializers/sinks so storage remains provider-agnostic.
- Emit a standards-based W3C manifest for portability.
- Add a nine-stage Operator Flow status so the future UI can show one clear current step.

## Remaining intentional gaps

0.10.0 packages and validates; it does not automate retailer logins or submit titles. Retailer automation belongs after the Book One/Book Two Superman production tests prove the output itself.
