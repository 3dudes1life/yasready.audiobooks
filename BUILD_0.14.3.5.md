# YasReady Audiobooks 0.14.3.5 — Human Taste Calibration & Narrator Search Refinement

This release uses the first real single-narrator human review as operator calibration.

Human verdict from the reviewed shortlist:
- 0 Keep
- 1 Maybe
- 5 Pass

The system does NOT pretend it analyzed acoustic similarity. It learns only from the provider metadata associated with the human review and uses that to stop wasting shortlist slots.

## What the real round exposed

The 0.14.3.4 metadata score still over-valued generic narrator categories.

Examples:
- a young Hispanic podcast-host profile with a selected Canadian English preview ranked #1 despite human rejection
- several middle-aged voices consumed shortlist slots even though the creative target is young
- a young Indian-English narrator could score 100 role-fit from generic warm/confident/narration keywords even though the selected preview was outside the US/SoCal target
- the one human Maybe was a young, American, conversational, low/smooth/personable US-born Latino profile

## 0.14.3.5 changes

- adds Human Taste Fit as a first-class score
- middle-aged/senior narrator profiles are hard-excluded from the Book One shortlist
- selected English preview must be US-English with an American/California/West Coast-compatible accent for the Book One shortlist
- conversational/personable/smooth/low/warm/natural metadata is strongly preferred
- documentary/business/tutorial/customer-support/announcer/corporate styling is penalized
- `narrative_story` alone is no longer enough to create a great narrator score
- explicit Latino metadata is still required for auto-audition
- cultural identity still comes only from explicit provider metadata, never sound or name
- refined zero-spend search terms target young US Latino conversational voices
- no paid audition or production generation is armed

This is a metadata calibration from human judgment, not acoustic voice cloning or biometric inference.
