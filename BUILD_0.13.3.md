# YasReady Audiobooks 0.13.3 — Casting Scope Integrity Closure

0.13.3 is the surgical follow-up to 0.13.2. It closes the residual Casting Room scope-membership gap found by the final hostile SaaS-boundary pass without changing the rest of the production stack.

## Closure work

- Casting Room now proves that a character belongs to the requested series before staging, importing, or locking a series-scoped voice.
- Book-scoped Casting now proves that the character is visible to that exact book Audio Bible, including legitimate parent-series inheritance.
- A Book 1-only character can no longer be staged or locked against Book 2 merely because both books share a project.
- A Series A character can no longer be locked into Series B merely because both series share a project.
- `scope: "book"` locks now require `bookId`; successful-looking orphan book assignments can no longer be created.
- Existing project ownership, series-safety, explicit recast, Money Guard, Director, Production, Review, QA, Mastering and Distribution behavior is otherwise unchanged.

## Hostile regression fixture

`test/casting-scope-integrity.test.js` covers the three reported attacks plus one positive inheritance regression:

1. Book 1-only character -> Book 2 staging is rejected.
2. Series A character -> Series B lock is rejected.
3. Book-scoped lock without `bookId` is rejected and no assignment is persisted.
4. A real series character remains usable by a book whose Audio Bible inherits that series Bible.

The fixture is zero-spend and never calls a voice provider.

## Validation

Run:

```bash
npm run check
npm test
npm run casting:fixture
npm run boundary:fixture
npm run closure:fixture
npm run superman:fixture
npm run money-guard:fixture
```

0.14.0 remains **External Book Superman** once this closure set is green on the live repository.
