---
name: poetics-debug
description: Use when tracking down a regression in a Poetics repo, to walk a component's dependencies and their version history to find which unit version changed behaviour.
---

# Find the unit version that changed behaviour

Day-one version: closure hashes are not computed yet, so you walk the graph
yourself. When the indexer lands, step 2 becomes `poetics_impact` and step 3
compares closure versions directly.

1. **Start from evidence:** the failing test, stack trace or bug report. Map
   each frame or file to a unit (`poetics-orient`).
2. **Walk dependencies:** from the failing unit, follow `deps` in its newest
   version to the units it uses, recursively. Note each one's versions since
   the last known-good commit (`git log` on the unit file shows when entries
   were added).
3. **Narrow down:** prefer `behaviour` and `interface` versions; their
   rationale often names the cause. `git bisect` over the commits that added
   those versions if it is not obvious.
4. **Fix with `poetics-change`**, linking the regression issue, and add a test
   that would have caught it.
