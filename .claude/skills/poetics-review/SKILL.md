---
name: poetics-review
description: Use when reviewing a diff or pull request in a Poetics repo, to list interface breaks, unrecorded changes and weak rationale.
---

# Review a change with Poetics

Day-one version: you compare the diff with `.poetics/units` by hand. When
`poetics_impact` and `poetics_verify` land, steps 2–4 become calls to them.

1. Run `pnpm poetics changes origin/<base branch>` to read every recorded
   change and its rationale, newest first, then `pnpm validate` and
   `pnpm poetics:check --since origin/<base branch>`.
   Any error blocks the review. Steps 2–5 below are what the check automates;
   read its warnings and confirm them by hand.
2. **Changed units:** for every exported function, hook, component or type the
   diff touches, check its unit file gained a version entry with the right
   `change` class and a `parent` equal to the previous `contentHash`. Code
   changes with no version entry are findings.
3. **Interface breaks:** for each `interface` change, list the units that
   depend on it and check each was updated.
4. **Refactors:** renames, moves, splits and merges must keep uids and add
   `lineage`. A deleted unit file is a finding: removals are a final
   `removed` version, and their dependents need versions too.
5. **Tests:** each `behaviour` or `interface` change has a changed or new test.
6. **Rationale quality:** specific to the unit, says why rather than what, and
   cites an issue, task, decision or plan section. Agent-written entries stay
   `reviewed: false`; only a human reviewer flips them.
7. **Changeset:** user-facing package changes have a `.changeset/*.md` entry
   with a bump type that matches the change class (interface → major or minor
   while < 1.0).
