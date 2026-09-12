# YasReady Audiobooks

**Version 0.1.0 — Production Foundation**

YasReady Audiobooks is a standalone audiobook-production service designed to later integrate with YasReady Publishing without coupling experimental audio code to the publishing platform.

## 0.1.0 goals

This release establishes the durable production model used by all later builds:

- Book → Chapter → Scene → Segment → Take → Master hierarchy
- characters, voice assignments, pronunciations, providers and audio assets
- explicit project state machine and approval locks
- provider-neutral audio generation contract
- deterministic render fingerprints to avoid paying twice for identical work
- append-only production cost ledger
- immutable asset manifests and provenance metadata
- in-memory repository for tests and local development
- zero external runtime dependencies

No voice generation is performed in 0.1.0. Provider integrations arrive in later builds.

## Run

Requires Node 20+.

```bash
npm test
npm run demo
```

## Safety rule

Do not commit manuscripts, generated masters, voice assets, customer content or API secrets to this repository. Use private object storage and environment/secret management.

## Architecture contract

The publishing platform should eventually integrate through a narrow API boundary, not by copying audiobook internals into Publishing.

See `docs/ARCHITECTURE.md` and `docs/ROADMAP.md`.
