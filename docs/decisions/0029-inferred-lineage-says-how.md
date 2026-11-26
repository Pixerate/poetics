# 0029. Lineage inferred from shape says how it was found

- Status: Accepted (2026-11-26)
- Date: 2026-11-25
- Refines: [ADR 0028](0028-lone-pair-in-a-file.md)

## Context

ADR 0028 pairs a file's lone leftover units at a similarity of 0.2. In
Swift that floor does not separate renamed units from unrelated ones, so a
`via: "lone"` match is a guess worth a look in review. Until now only the
`poetics index` dry run said so. Once written, a lone match's lineage entry
was a plain `{ "kind": "rename", "from": "old" }`, the same as one a person
declared. A reviewer reading the pull request, `poetics_history` or `poetics
why` had no way to tell, and `poetics:check` passed it silently.

Options considered:

- **Queue lone matches instead of writing them.** Safe, but it gives up what
  ADR 0028 bought, and a queue that fills with right answers teaches people
  to approve it without looking.
- **Warn in `poetics index` only.** The warning is gone by the time anyone
  reviews the pull request.
- **Record how the entry was found, and warn where review happens.** The
  unit file keeps the evidence, and the check that pull requests already run
  raises it once.

## Decision

**A lineage entry inferred from shape records `via` and `score`, and
`poetics:check` warns on new lone entries.**

- `poetics index` adds `via` (`"similarity"` or `"lone"`) and `score` to
  each lineage entry of a match that rested on similar syntax trees. Entries
  that were declared, or found by place, content or owner, carry neither:
  those are facts, not inferences.
- `poetics:check` reports `lone-match`, a warning, for each lineage entry
  with `via: "lone"` that the change adds. An entry an earlier commit
  recorded is not reported again.
- `poetics history` and `poetics why` show it as `rename from old (found by
  lone 0.43)`.

## Consequences

- A reviewer sees every lone match in the pull request's check output, and
  `pnpm preflight` shows it to whoever ran `poetics index`.
- Similarity matches above 0.65 are recorded too but raise no warning. If
  they turn out to need review, the data is already there.
- A wrong lone match is fixed as before: declare which unit is which with
  lineage and run `poetics index` again, or split the change into two
  commits.
- Unit files gain two optional fields on lineage entries. Older files stay
  valid. The SQLite index does not store them, since nothing queries them
  yet.
