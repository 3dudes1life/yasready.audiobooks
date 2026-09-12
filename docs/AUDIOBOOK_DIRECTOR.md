# YasReady Audiobooks 0.5.0 — Audiobook Director

The Director is a non-destructive performance layer between the canonical manuscript and an audio provider.

## Rules
- Canonical manuscript text is immutable inside Director workflows.
- Direction is stored separately as emotion, pace, intensity, restraint, volume, pauses and provider-neutral tags.
- Dialogue must have a canonical character binding before direction is approved.
- Manual direction changes are audited and locked cues cannot be edited until intentionally unlocked.
- Provider compilation happens only at render time.

## Eleven v3
The v3 compiler may add a small allowlisted set of bracketed audio tags to a temporary render string. The canonical manuscript is never rewritten.

## Default style
`premium-natural` favors restraint. The system deliberately avoids decorating every sentence with acting instructions. The target is professional audiobook narration, not an overacted audio drama.
