# YasReady Audiobooks

Professional audiobook production infrastructure for YasReady Publishing.

**Current build: 0.4.0 — Casting Room**

The project is being developed as a standalone service first so audiobook experimentation cannot destabilize YasReady Publishing.

## Implemented
- production-safe project/domain foundation
- manuscript intelligence for EPUB, DOCX and text
- chapter, scene, narration and dialogue segmentation
- series-aware Audio Bible
- canonical characters, aliases, relationships and pronunciations
- series/book continuity hierarchy
- provider-neutral casting architecture
- ElevenLabs Voice Library/saved voice adapter
- long-term voice safety scoring
- audition planning, cost ceilings and duplicate render reuse
- locked, auditable series/book cast assignments

## Safety rules
- Never commit manuscripts, generated masters, provider keys or customer audio.
- Live paid rendering requires an explicit runtime provider key.
- Casting auditions are cost-estimated before generation and must remain under their plan budget unless explicitly overridden.
- Series voice assignments fail closed when long-term voice safety is below the configured threshold.
- Locked cast assignments cannot be silently recast.

## Tests

```bash
npm test
npm run check
```

## Roadmap
0.5.0 is the Audiobook Director: performance intent, pacing, emotional beats and render instructions without changing canonical manuscript text.
