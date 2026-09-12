# Audio Bible Architecture

The Audio Bible is the canonical production identity layer between manuscript analysis and voice casting.

## Hierarchy

A series may own a **series Bible** containing recurring characters, aliases, relationships and pronunciations. A book may own a **book Bible** and inherit one series Bible. Book-only characters live locally while recurring characters remain canonical at series scope.

## Resolution policy

Speaker candidates produced by manuscript parsing are evidence, not truth. Audio Bible resolution only performs normalized exact matches against canonical names and explicit aliases. It does not fuzzy-match or invent identities. A resolved dialogue segment receives a separate `speaker_binding` audit record.

## Pronunciation precedence

Book Bible rules override matching series Bible rules. This permits a one-book exception without mutating the canonical series pronunciation.

## Rendering contract

`snapshot(bibleId).digest` changes whenever production-relevant Bible content changes. Future rendering builds must include this digest in their generation fingerprint so stale audio is never silently reused after a casting, performance, or pronunciation change.
