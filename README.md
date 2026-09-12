# YasReady Audiobooks

**Version 0.2.0 — Manuscript Brain**

YasReady Audiobooks is a standalone audiobook-production service designed to later integrate with YasReady Publishing through a narrow, stable API boundary.

## What 0.2.0 adds

- native EPUB, DOCX and UTF-8 text manuscript intake
- no runtime package dependencies for manuscript extraction
- EPUB package/spine ordering and metadata extraction
- DOCX paragraph and core metadata extraction
- chapter-heading detection with front/back matter support
- explicit scene-break detection
- narration/dialogue segmentation
- conservative speaker-candidate attribution with confidence/evidence
- words, source characters, production characters and runtime estimates
- source and normalized-text SHA-256 integrity hashes
- warnings when chapter/dialogue structure looks suspicious
- persistence into the 0.1.0 Book → Chapter → Scene → Segment model
- CLI manuscript analysis without making any voice-provider calls

## Run

Requires Node 20+.

```bash
npm test
npm run check
npm run demo
node src/cli.js analyze /path/to/book.epub
```

## Production-count rule

`sourceCharacters` measures the normalized extracted manuscript. `productionCharacters` measures the current narration/dialogue segments and is an estimate of text that will eventually be sent to a voice provider. Later director/casting builds may change billable character counts, so 0.2.0 does not present it as a final quote.

## Safety rule

Do not commit manuscripts, generated masters, voice assets, customer content or API secrets to this repository. Manuscripts are read at runtime and represented in the production model; customer source files belong in private storage.

## Architecture contract

Publishing should eventually call the audiobook service rather than importing its internal implementation.
