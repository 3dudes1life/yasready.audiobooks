# YasReady Audiobooks 0.14.3.20.5 — Human Pause Review & Local Repair Preview

## R3 — Relocated Audio Resolver

- Historical Pause Deficit Audits remain immutable even when their absolute source-audio path is stale.
- If an audit path no longer exists, Human Pause Review searches bounded local roots for the chapter MP3.
- A relocated MP3 is accepted **only** when its SHA-256 digest exactly matches the digest locked in the audit.
- If the historical path still exists but its digest changed, YasReady fails closed and does not search around the mismatch.
- Default CLI search roots include the audit folder, review/output parent, Desktop, Downloads and Documents.
- `--audio-root /path/to/folder` may be supplied one or more times for an explicit moved-audio location.
- Preview generation and approved repairs both use the same digest-verified resolver.
- Original audio remains immutable; provider/TTS calls remain zero; Chapter 11/full-book generation remain OFF.
- Existing bounded A/B preview, explicit human approval, derivative repair and post-repair waveform proof remain unchanged.


## R4 — Mac-wide audited audio recovery

- Historical source path remains immutable evidence.
- Resolver requires the original locked SHA-256 digest.
- macOS Spotlight searches the full indexed machine.
- Targeted find fallback searches the home folder and mounted volumes for plausible chapter MP3 names.
- Only an exact digest match may bind to the historical pause audit.
- If the audited MP3 is truly gone, old timing evidence is refused and a fresh Pause Deficit Audit is required.
- No provider/TTS calls. Originals remain immutable.
