# 0012. Assumptions, considerations and planned work are notes

- Status: Proposed
- Date: 2026-10-29

## Context

Some knowledge about the code is not yet true or not yet done:

- **Planned work:** a deliverable, a follow-up, a stub waiting to be built.
- **Unvalidated assumptions:** "svelte2tsx output is stable within a minor
  version", "no unit file exceeds 1 MB". The code relies on them, but nobody
  has checked.
- **Considerations for future development:** "if the store passes 10,000
  units, switch to the sharded layout", "when Svelte 6 ships, revisit the
  rune adapter".

Today these end up in three places, none of them tied to the code:

- planned work in GitHub issues and milestones, which say what to do but not
  which units it touches, so an agent editing those units never sees it;
- assumptions and considerations in rationale prose, PR descriptions or
  nowhere;
- `TODO` and `FIXME` comments, which the source has none of yet, but which
  [ADR 0011](0011-backfill.md) already expects to find in adopting
  repositories.

Two existing rules constrain the design:

- **Links are references, never content**
  ([plan: issue trackers](../plan.md#issue-trackers)). A work item's
  description and status belong to its tracker; copying them into git lets
  the two drift.
- **Source text is the source of truth**
  ([ADR 0001](0001-text-is-source-of-truth.md)). People will keep writing
  `TODO` comments, so they have to be part of the answer, not banned.

Options considered:

- **A todo store, `.poetics/todos/`.** A new entity with its own schema,
  lifecycle, rendering and tools, duplicating most of what notes already do,
  and competing with the issue tracker for planned work.
- **Links on units only.** A unit could link to the issues and assumptions
  about it. But links live on versions, which record a past change; open items
  are about the future and must outlive the version that added them.
- **New note kinds.** Notes ([ADR 0006](0006-notes-replace-gotchas.md))
  already have anchors that surface them when a task touches what they are
  about, `observedAt` that flags them when an anchored unit changes, a
  `check`, a lifecycle that retires instead of deleting, and planned tools
  that find them. An assumption has the same ladder as a gotcha: stated, then
  checked, then confirmed or refuted.

## Decision

Notes gain three kinds. Planned work stays in the issue tracker; a note only
anchors it to the code.

| Kind | What it records | Retired when |
| --- | --- | --- |
| `assumption` | Something the code relies on that has not been verified | Confirmed or refuted |
| `consideration` | Something to weigh when a condition is met or the anchored code changes | Acted on, or no longer relevant |
| `planned` | Work intended on the anchored code | Done or dropped |

### Fields

- `symptoms`, `cause` and `fix` become required only for `gotcha`,
  `workaround` and `invariant`, with `if`/`then` rules like the ones
  `resolved` and `superseded` use.
- The new kinds require a `statement`: the assumption, the consideration or
  the work, in one or two sentences.
- `assumption` also requires a `consequence`: what breaks if it is false. An
  assumption with no consequence is not worth recording.
- `consideration` may have a `trigger`: the condition that makes it relevant
  ("more than 10,000 units"). A trigger about a dependency is a `dependencies`
  anchor with a range instead, so `poetics verify` can detect it.
- `planned` should link to its tracker item (`github-issue`, later
  `uchiage-task`). When it does, the tracker's status is authoritative and the
  note carries no description beyond `statement`. Without one, the note stands
  alone, so the core still works with no tracker reachable.
- **The new kinds need at least one anchor.** Something that is not about a
  unit, path, dependency or command belongs in an issue, not `.poetics/`.
- `check` keeps its meaning. An assumption with a check is on its way to
  being confirmed; when the check passes, the note is resolved.

### Lifecycle

`status` stays `active | resolved | superseded`, so every kind retires the
same way. A resolved `assumption` adds `outcome: confirmed | refuted`; a
refuted assumption's `resolvedBy` points at the change that dealt with it.
Notes are never deleted.

### Where they appear

- **`poetics-orient`, and later `poetics_context_pack`:** active notes of
  every kind anchored to the unit's closure. An agent about to change a unit
  sees what is assumed about it and what is planned for it.
- **`pnpm validate`:** the existing warning when an anchored unit is newer
  than `observedAt` applies unchanged: the assumption was made against older
  code, so re-check it.
- **`poetics notes`:** filters by `--kind`; `poetics verify` lists active
  assumptions with no check.
- **Not in `GOTCHAS.md`.** It is the list read before starting work; open
  items would dilute it. `renderGotchas` skips the new kinds.

### `TODO` comments

`poetics:check` warns when a change adds a `TODO`, `FIXME` or `HACK` comment
with no reference: `TODO(#23)` for a tracker item, or `TODO(note:<id>)` for a
note. `poetics:coverage` counts unreferenced ones. The comment stays where
people expect it; the reference ties it to something with a lifecycle.

### Stubs

A `notImplemented()` stub is planned work already encoded in code.
`poetics:coverage` reports stubs, and a stub's unit may be anchored by a
`planned` note that links to its issue.

## Consequences

- Open items reach an agent when it touches the code they are about, instead
  of living in a tracker it never reads.
- Assumptions become checkable and go stale visibly, and the record shows
  which ones were refuted and what that changed.
- No second tracker: planned work keeps one source of status.
- Notes are no longer only gotchas, so the `poetics-gotcha` skill's guidance
  does not cover them. A `poetics-note` skill, or a section in
  `poetics-change`, has to say when to record each kind.
- The anchor rule is the guard against notes becoming a dumping ground; it
  needs to be enforced by `checkStore`, not left to the skill.
- Follows acceptance: the new kinds and fields in `schemas/note.schema.json`,
  the `Note` type in `packages/core/src/types.ts`, `renderGotchas`,
  `docs/data-model.md` and the skills; the `TODO` rule in `poetics:check`;
  stub counts in `poetics:coverage`.
- Open questions, to be filed as issues:
  - Should open items get a generated document of their own for readers
    without MCP, or are `poetics notes --kind` and orient enough?
  - Should `planned` notes be created automatically from tracker items whose
    text names a unit, or always by hand?
  - Should the `TODO` rule be a warning or, once a repository has none
    unreferenced, an error?
