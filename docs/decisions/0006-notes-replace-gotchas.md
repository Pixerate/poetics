# 0006. Gotchas are anchored notes; GOTCHAS.md is generated

- Status: Accepted
- Date: 2026-10-27

## Context

Many repositories keep a hand-written `GOTCHAS.md` of quirks and workarounds
for agents to read. It helps, but as a flat document it:

- is read all at once at the start of a session, when the agent cannot yet tell
  which entries matter, or not read at all;
- goes stale silently, because nothing ties an entry to the code, dependency or
  command it describes;
- only grows, because nothing says when an entry is resolved or has become an
  automated check.

Poetics already attaches structured, versioned metadata to units. A gotcha is
metadata about code and tooling, so it can take the same form.

## Decision

- Each gotcha, workaround or invariant is a **note**: one JSON file in
  `.poetics/notes/<id>.json`, validated by `schemas/note.schema.json`, with the
  same merge-friendly layout as unit files.
- A note carries verbatim `symptoms`, `cause`, `fix`, a `kind`, an `area`, and
  `anchors` to units (with `observedAt`, the unit's contentHash when the note
  was confirmed), paths, dependency ranges and commands.
- A note may point at a `check` (test, validator rule, command or config) that
  catches it. Notes are pushed up a ladder: note → check → fix.
- Notes are retired with `status: resolved | superseded`, never deleted.
- `GOTCHAS.md` is **generated** from notes by `pnpm gotchas` and checked in CI
  with `pnpm gotchas --check`. It stays for humans and for agents without the
  MCP server.
- Day one, `pnpm validate` checks note schemas, anchors and check files, and
  warns when an anchored unit has a newer version than `observedAt`.

Planned (see the plan's agent interface):

- `poetics_notes` (read) finds notes by error text, unit, path or command, and
  `poetics_record_note` (write) appends one, attributed and unreviewed.
- `poetics_context_pack` includes active notes anchored to the units in a
  task's closure.
- A Claude Code hook on failed tool calls looks up the error text and injects
  the matching fix.
- `poetics verify` flags notes whose anchored dependency moved outside its
  range, or whose check stopped failing.
- The SQLite index gains notes tables and full-text search over symptoms.

## Consequences

- Agents get a gotcha when it is relevant instead of reading every entry.
- Staleness becomes detectable, starting with unit anchors.
- Writing a gotcha takes a little more effort than appending prose; the
  `poetics-gotcha` skill and, later, `poetics_record_note` keep that cheap.
- Hand edits to `GOTCHAS.md` fail CI; contributors need to know to edit notes.
