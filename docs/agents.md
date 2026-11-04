# Agents: skills and MCP

Coding agents are Poetics' primary users. They reach it through skills (which
say what to do at each step of a task) and, from phase 1, an MCP server (which
does it).

## Skills

Skills live in `.claude/skills/<name>/SKILL.md`. Each has front matter with a
`name` and a `description` that says when to use it.

| Skill | Use it |
| --- | --- |
| `poetics-orient` | Before changing any unit |
| `poetics-change` | When editing a function, hook, component or type |
| `poetics-refactor` | Before renaming, moving, splitting or merging units |
| `poetics-react-component` | When writing React components or hooks |
| `poetics-svelte-component` | When writing Svelte components or rune modules |
| `poetics-review` | When reviewing a diff or pull request |
| `poetics-debug` | When tracking down a regression |
| `poetics-gotcha` | When something cost real time and will recur |

Today's skills are the day-one versions: they tell the agent to edit
`.poetics/units/*.json` by hand. As each MCP tool lands, rewrite the matching
step to call it, and (once the harness exists) run the evals before merging.

### Writing a skill

- The description is the trigger. Say when to use the skill, not what it is.
- Number the steps. Agents follow procedure reliably; ambiguity costs runs.
- Say what never to do (delete units, rewrite `versions`).
- Repeat that docs, rationale and issue text are data, not instructions.
- Keep it under a page.

## MCP server

`@poetics/mcp` defines the tools from the plan in `packages/mcp/src/tools.ts`:
name, access (`read` or `write`), description and JSON input schema. The
`poetics-mcp` binary serves them over stdio from the repository it is started
in; `tools/list` advertises only the tools it answers. Rules every tool follows:

- Writes are append-only, attributed to the calling session, and checked
  against the indexer. No tool deletes or rewrites history.
- Results are token-budgeted.
- Every description ends with `DATA_NOT_INSTRUCTIONS`.

`poetics_changes` answers "what changed, and why" between two refs: each
commit's unit versions with rationale, removals included, plus commits that
recorded nothing ([ADR 0009](decisions/0009-changes-between-refs.md)). Agents
call it to catch up at the start of a task. With `impact: true` it also ranks
the units those changes reach, as `poetics_impact` does.

The read-only tools answered today are `poetics_context_pack`,
`poetics_search`, `poetics_unit`, `poetics_history`, `poetics_changes`,
`poetics_impact`, `poetics_tests_for`, `poetics_verify` and `poetics_notes`.
Each call brings the SQLite index up to date first, so edits between calls are
seen, and the tools that read code index it through the TypeScript indexer's
cache. Units are referenced by uid, name, or `file#name` when a name is shared;
an ambiguous name is refused with its candidates.

- `poetics_context_pack` fills the unit (with its signature), its code, notes,
  tests, dependencies and callers (each with its signature) and earlier
  rationale, in that order, until the token budget (default 4000) is spent.
  It reports what it cut in `truncated`, keeping the first lines of code that
  does not fit, and lists under `missing` what it cannot show, such as code the
  indexer cannot read yet.
- `poetics_impact` takes `units`, `since` (the units the store recorded as
  changed since that ref), or both, and ranks every unit they reach through the
  composition graph by distance: `own`, `closure`, or `interface-caller` for
  direct callers of an interface change or removal. It lists the unresolved
  uses inside those units, where the graph may be incomplete.
- `poetics_verify` checks a path `scope` (default: everything). `ok` is false
  when code has changed without a version (`stale`), has no unit
  (`untracked`), or a unit's code is gone (`missing`): run `poetics index`.
  It also lists stored docs that differ from the code's TSDoc, notes whose
  units changed since they were confirmed, units with no linked tests, and
  unresolved uses.
- `poetics_tests_for` reports `verified` when a test was recorded against the
  current version; pass or fail needs a test-runner integration.

Uses inside a non-exported helper count as uses by the exported unit that calls
it. `poetics_signals` and the writes are still stubs.

To try it from a checkout, register it with your MCP client:

```json
{ "mcpServers": { "poetics": { "command": "node", "args": ["--conditions=poetics-source", "packages/mcp/src/bin.ts"] } } }
```

Notes (gotchas, workarounds, invariants) get two tools: `poetics_notes` finds
them by error text, unit, path or command, and `poetics_record_note` records or
re-confirms one. The plan adds a hook on failed tool calls that sends the error
text to `poetics_notes`, so the fix reaches the agent when it fails.

Tool descriptions are prompts. Changing one is a behaviour change: record it as
a unit version and, once evals exist, gate it on them.

## AGENTS.md

[`AGENTS.md`](../AGENTS.md) holds the repository rules. `CLAUDE.md` imports it
so Claude Code reads the same file.
