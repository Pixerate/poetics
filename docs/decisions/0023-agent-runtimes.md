# 0023. Skills ship once in the Agent Skills format, and evals run an agent through a configured command

- Status: Accepted (2026-11-28)
- Date: 2026-11-14

## Context

[#7](https://github.com/Pixerate/poetics/issues/7) asks which agent runtimes
skills and evals target first, and whether skills ship in one format or as a
variant for each runtime.

The skills live in `.claude/skills/<name>/SKILL.md`: a folder per skill, with
front matter giving a `name` and a `description` that says when to use it.
That shape has since become the Agent Skills format, an open specification
read by most coding-agent runtimes. They differ mainly in where they look:
`.agents/skills/` is the shared project location, and some runtimes also read
or only read a directory of their own, such as `.claude/skills/`.
`AGENTS.md` is read by most runtimes, and `CLAUDE.md` imports it.

The eval harness (#25) runs benchmark tasks against fixtures with and without
Poetics, so it has to start an agent. Poetics must stay model- and
provider-agnostic: it names no model, ships no vendor SDK, and calls models
through a command the repository configures ([ADR 0017](0017-drafting-through-a-command.md)).

Options considered for skills:

- **A variant for each runtime,** generated from one source. It would allow
  per-runtime wording and tool names, but the format no longer differs between
  runtimes, so it would add a build step and a drift check for paths alone.
- **One copy in `.claude/skills/`.** Nothing to keep in step, but runtimes
  that read only `.agents/skills/` would not find the skills.
- **One copy in `.agents/skills/`, mirrored to `.claude/skills/`.** The shared
  location is the source, and runtimes that read only their own directory
  still find the same files.

Options considered for evals:

- **Built-in adapters for named agent CLIs.** Easy to start, but each one
  names a vendor in code and needs upkeep as those CLIs change.
- **A configured command.** The harness runs whatever agent the user
  configures, as backfill drafting runs a model.

## Decision

**Skills ship once, in the Agent Skills format, from `.agents/skills/`.**
Each skill is one `SKILL.md` in a folder named after it, with only the
`name` and `description` front matter the specification requires, and no
runtime-specific fields. There are no per-runtime variants.

**`.claude/skills/` is a byte-for-byte mirror** of `.agents/skills/`, for
runtimes that read only that directory. It is a copied tree rather than a
symlink, so it survives checkouts and packages on every platform.
`pnpm skills` writes it, and `pnpm skills --check`, run by `pnpm preflight`,
fails when it drifts. Edits go to `.agents/skills/` only. Another runtime's
directory is mirrored the same way when a runtime needs it.

**`AGENTS.md` stays the one rules file,** pointing at `.agents/skills/`.
Runtime-specific files such as `CLAUDE.md` only import or point to it.

**Evals start an agent through a configured command,** never a named runtime.
The harness runs the command as an argv array, without a shell, in a fresh
copy of the fixture, with the task's prompt on stdin, and judges the result
from the fixture afterwards: the task's `success` checks and its `poetics`
expectations. The command reports what it can (tokens used, for example) as
JSON on stdout. The harness names no runtime or model. Its docs give example
commands, and the first runtimes measured are the ones maintainers use.

## Consequences

- One skill text reaches every runtime that reads the Agent Skills format, so
  a skill change is reviewed and evaluated once.
- A skill cannot use one runtime's extensions to the format. Steps that need
  a runtime feature, such as a hook on failed tool calls, are documented as
  optional for that runtime rather than written into the skill.
- The mirror doubles the skill files in the repository. The check keeps them
  identical, and a diff touching only the mirror is a mistake to undo.
- `poetics init --agents` installs skills to `.agents/skills/`, and mirrors
  them for a runtime only when asked.
- The harness's protocol for the agent command is defined with #25. An eval
  result names the command that produced it, so results from different
  runtimes are not compared as one.
