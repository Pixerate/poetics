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
call it to catch up at the start of a task. `impact: true` waits for the
indexer.

The read-only tools answered today are `poetics_context_pack`,
`poetics_search`, `poetics_unit`, `poetics_history`, `poetics_changes`,
`poetics_tests_for` and `poetics_notes`. Each call brings the SQLite index up
to date first, so edits between calls are seen. Units are referenced by uid,
name, or `file#name` when a name is shared; an ambiguous name is refused with
its candidates. `poetics_context_pack` fills the unit, its notes, tests,
dependencies, callers and earlier rationale in that order until the token budget
(default 4000) is spent, and reports what it cut in `truncated`. Code and
signatures are listed under `missing` until the indexer (#19) records spans.
`poetics_tests_for` reports `verified` when a test was recorded against the
current version; pass or fail needs a test-runner integration. `poetics_impact`,
`poetics_verify`, `poetics_signals` and the writes are still stubs.

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
