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
name, access (`read` or `write`), description and JSON input schema. The server
itself is a stub. Rules every tool follows:

- Writes are append-only, attributed to the calling session, and checked
  against the indexer. No tool deletes or rewrites history.
- Results are token-budgeted.
- Every description ends with `DATA_NOT_INSTRUCTIONS`.

Tool descriptions are prompts. Changing one is a behaviour change: record it as
a unit version and, once evals exist, gate it on them.

## AGENTS.md

[`AGENTS.md`](../AGENTS.md) holds the repository rules. `CLAUDE.md` imports it
so Claude Code reads the same file.
