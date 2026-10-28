# 0010. Removal is a version; unit files are never deleted

- Status: Accepted
- Date: 2026-10-28

## Context

The convention was to append a final version saying why a unit was removed,
then delete its unit file, leaving history in git. A tombstone format was an
open question. Once the file is gone, nothing in the store says the unit ever
existed: `poetics log <uid>` has nothing to read, and "what changed, and why"
([ADR 0009](0009-changes-between-refs.md)) would have to special-case deleted
files. No unit file had been deleted yet, so nothing needs migrating.

Options considered:

- **A top-level `removed: { … }` field.** Easy to filter, but it duplicates
  rationale, actor and links that a version already carries.
- **A separate tombstones directory.** A second store with its own schema and
  rules, for one fact per unit.
- **A `removed` change class**, appended as the unit's last version.

## Decision

Removal is a version with `change: "removed"`, and the unit file stays.

- `removed` may only be the last version; nothing is appended after it.
- Its `contentHash` is git's empty-blob hash
  (`git:e69de29bb2d1d6434b8b29ae775ad8c2e48c5391`, exported as
  `REMOVED_CONTENT_HASH`): the unit's source is now empty. Dropping the hash
  would break every place that keys versions by it; the sentinel keeps the
  parent chain and the no-repeat rule intact. It is marked `provisional`, and
  the `allowProvisionalHashes` policy does not apply to it. It has no
  `interfaceHash` or `closureHash`.
- A removed unit's `location.file` and linked tests need not exist. Live units
  whose latest version still depends on it get a warning.
- Drift detection and coverage skip removed units. An export that reappears
  with the same name gets a new uid; if it really is the same unit returning,
  `poetics-refactor` declares lineage to the old one.
- `poetics:check` fails when a unit file is deleted, and its orphan finding now
  says to append a `removed` version.
- Units replaced rather than dropped link to their successor from the removed
  version's `links`; the successor records `split` or `merge` lineage.

## Consequences

- History survives deletion in the store itself, for humans, agents and
  `poetics changes`.
- The store grows monotonically. Unit files are small; if a repository ever
  needs to, a later prune can move removed units out of the working tree.
- Search, impact and the index skip removed units by default once they exist;
  `poetics_unit` and `poetics_history` still return them.
- Exports deleted before a repository adopted Poetics are not recovered; a git
  scan in `poetics init` could add that later.
