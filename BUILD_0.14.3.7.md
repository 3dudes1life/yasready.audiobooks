# YasReady Audiobooks 0.14.3.7 — Audition Spend Precision Hotfix

The first real 0.14.3.6 audition plan exposed a money-UX precision bug:

- exact estimate: $0.2502
- exact reserve: $0.06255
- raw protected maximum: $0.31275
- the plan/UI printed `$0.31`
- the renderer correctly compared the operator cap against the unrounded `$0.31275`
- therefore `--max-usd 0.31` was rejected even though YasReady itself told the operator to use `$0.31`

No provider generation occurred. The spend guard failed closed before TTS.

## Fix

0.14.3.7 makes the protected maximum an operator-facing currency value:

`protected maximum = CEILING(raw protected amount to the next cent)`

For the real Book One plan:

`$0.31275 -> $0.32`

The exact same value is now used by:
- plan JSON
- plan Markdown
- confirmation text
- CLI next-action command
- renderer minimum-cap validation
- plan fingerprint
- Money Guard

The system never rounds a protected maximum downward.

## Safety

- Existing failed render spent $0 because the guard blocked before provider writes/TTS.
- Operators must regenerate the plan after this hotfix because the protected max and plan fingerprint change.
- Explicit confirmation token + explicit max cap remain required.
- $5 audition hard ceiling remains unchanged.
- Production remains unarmed.
