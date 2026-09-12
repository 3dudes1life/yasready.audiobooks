# Final SaaS Boundary Closure

Release 0.13.2 is the final pre-External-Book boundary hardening pass. Its purpose is to ensure that a multi-project SaaS cannot accidentally mix customer truth, silently drift approved direction, skip QA coverage, double-render after billing, or export a package whose inputs changed after packaging.

## Invariants

1. Project/book ownership is checked where data crosses Casting, Director, Production, Review, QA and Mastering boundaries.
2. Production may use real Director plans only while the plan and referenced cues are locked. Unlocking Director truth stops later rendering until it is reviewed and re-locked.
3. Provider-render failures have an explicit audited retry path. Once a provider returns successfully, downstream storage failure cannot cause the provider to be called again; the already-rendered asset must be recovered explicitly.
4. QA cannot lock until every selected Review Studio take has evidence from that exact QA run. Mastering verifies the same exact run even without a QA-service adapter.
5. Distribution packages carry a source digest. Package-producing changes invalidate the package, and stale packages cannot export or finalize.
6. Accounted spend and provider-settled actual spend are separate fields. Estimated/billed-character accounting is never mislabeled as a settled provider invoice.
7. Series voice locks require a Casting Room safety score.

## Validation

Run:

```bash
npm test
npm run check
npm run boundary:fixture
npm run closure:fixture
npm run superman:fixture
npm run money-guard:fixture
```

All of the above are designed to run without paid provider generation.
