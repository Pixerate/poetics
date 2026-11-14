---
name: poetics-debug
description: Use when tracking down a regression in a Poetics repo, to walk a component's dependencies and their version history to find which unit version changed behaviour.
---

# Find the unit version that changed behaviour

The Poetics MCP server answers steps 2 and 3; without it, see the fallback.

1. **Start from evidence:** the failing test, stack trace or bug report. Map
   each frame or file to a unit with `poetics_context_pack` (`unit`, or
   `issue` for a reported bug; see `poetics-orient`). Call `poetics_notes`
   with the error text: the failure may already be a known pitfall.
2. **List what changed since it last worked:** `poetics_changes` with `from`
   set to the last known-good ref and `impact: true` gives every recorded unit
   version in the range, with rationale, and the units those changes reach.
   `poetics_impact` with `since` and the failing unit in `units` ranks the
   reach by distance; its unresolved uses are where the graph may miss a cause.
3. **Narrow down:** keep the changed units the failing unit reaches. Read each
   one's `poetics_history`, preferring `behaviour` and `interface` versions;
   their rationale often names the cause, and `poetics_signals` shows issues
   and review comments raised about them. `git bisect` over the commits that
   added those versions if it is not obvious.
4. **Fix with `poetics-change`**, linking the regression issue, and add a test
   that would have caught it.

**Fallback without the server:** follow `deps` in the failing unit's newest
version in `.poetics/units/<uid>.json`, recursively, and read each unit's
versions since the known-good commit (`git log` on the unit file shows when
entries were added); `pnpm poetics changes <from>` lists the range.
