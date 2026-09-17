# YasReady shared interface

All 16 generated Audiobook review pages now embed one shared visual layer from `src/ui/yasready-platform.js`. The layer provides the YasReady header, Business and Publishing links, light/dark control, opaque panels, green primary buttons, readable fields, and mobile layout adjustments. Workflow actions, review decisions, budget gates, audio files and provider behavior are unchanged.

`src/ui/yasready-platform-tokens.css` is byte-identical to Publishing's `src/styles/yasready-platform-tokens.css`, based on the existing YasReady Business styles. Update both copies together when changing the platform palette, typography, radii or primary button. Do not add new per-review brand colors. Review-specific layout and status meaning can remain in each renderer.

The CSS is embedded so downloaded review HTML needs no CDN, network request or extra CSS file. Theme preference uses `yasready-theme`, with an operating-system default, an accessible toggle, storage failure handling and same-origin tab synchronization. Separate domains retain separate browser preferences; this does not create cross-product authentication.

Existing HTML exports retain the CSS they were generated with. Regenerate only the review HTML using the updated renderer, or apply the safe presentation-only upgrade below. No narration needs to be generated again.

## Upgrade an existing review page

Run `node scripts/apply-platform-theme.mjs /absolute/path/to/review.html` to inspect whether an upgrade is needed. Add `--apply` to save the shared presentation into that same file. The script first makes a non-overwriting `.before-platform-ui.html` backup. It does not run workflow scripts, contact providers, regenerate audio, or change review payloads. Keep the HTML in its original directory so existing relative audio links continue to work. Reload the open review page afterward.

## Validation

583 automated tests passed, including original approval/budget boundaries and new shell preservation, repeat-application, preference synchronization and blocked-storage checks. Local browser checks covered the Human Pause Review in light and dark themes and a real 390px frame. Publishing sign-in and reset forms were checked in the same themes and mobile width. No provider calls or paid generation were used.
