# 0001. Source text stays the source of truth

- Status: Accepted
- Date: 2026-10-27

## Context

Poetics attaches identity, history, rationale, docs and test links to every
function, hook, component and type. That metadata could live inline (comments,
decorators, a custom file format) or beside the code.

## Decision

Source files stay ordinary `.ts`, `.tsx` and `.svelte`. All metadata lives in
the `.poetics/` sidecar. Compilers, bundlers, git hosts and CI see no change,
and deleting `.poetics/` leaves a normal working project. When the store and the
code disagree, the code wins and the store is repaired from it.

## Consequences

- Adoption is opt-in and incremental; one package of a monorepo can start alone.
- Identity has to be tracked without inline markers, which makes refactors the
  hardest problem (see `poetics-refactor` and declared lineage).
- Docs are written back into source on demand (`poetics docs sync`) so editors
  show them natively.
