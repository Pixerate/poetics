# Getting started

## Prerequisites

- **Node.js 24.15 or newer.** `.nvmrc` pins the major; `engine-strict` refuses
  older versions. Node runs the TypeScript scripts directly (type stripping) and
  provides the built-in `node:sqlite` module.
- **pnpm 12.** The version is pinned in `package.json` (`packageManager`);
  `corepack enable` picks it up.
- **git**, for history and the change check.

## Install

```bash
corepack enable
```

```bash
pnpm install
```

## Everyday commands

| Command | What it does |
| --- | --- |
| `pnpm test` | Run every unit test once (Vitest) |
| `pnpm test:watch` | Vitest in watch mode |
| `pnpm typecheck` | `tsc -b` over all packages, then type-check tests and scripts |
| `pnpm check` | `sv check` on the Svelte fixture, `tsc` on the React fixture |
| `pnpm validate` | Validate `.poetics/` (units and notes) against `schemas/` and the store rules |
| `pnpm gotchas [--check]` | Generate `GOTCHAS.md` from `.poetics/notes/`, or check it is up to date |
| `pnpm poetics log <unit> [--json]` | Every version of a unit, newest first, with hash, commit, author, rationale and links. A unit is a uid, a name, or `file#name` when a name is shared |
| `pnpm poetics why <unit> [--json]` | The rationale chain that led to a unit's current version, oldest first |
| `pnpm poetics changes [from] [to] [--json]` | What changed and why: every recorded unit change between two refs, grouped by commit (default: your branch since it forked, plus uncommitted work) |
| `pnpm poetics:check [--since <ref>] [--json]` | `poetics verify`: check a change recorded itself in `.poetics/` (default: working tree vs `HEAD`) |
| `pnpm poetics:coverage [--json]` | `poetics coverage`: coverage of the code by `.poetics/`, failing below `policy.coverage` |
| `pnpm build` | Build every package to `dist/` |
| `pnpm preflight` | Everything CI runs, in order |
| `pnpm reindex [--fresh]` | Rebuild the local SQLite index at `.poetics/cache/index.db` |
| `pnpm mint-uid [count]` | Print new unit uids for hand-written unit files |
| `pnpm poetics index [--since <ref>] [--write] [--rationale <text>] [--agent <tool> [--model <id>]] [--json]` | Record what changed since a ref (default `HEAD`): versions classified from their hashes, moves and renames with lineage, new units with fresh uids and removed ones, test links that follow test files git saw renamed, and units an adapter now sees as a different kind or framework (a function the React adapter claims as a component), which need no rationale. A dry run without `--write`; the rationale defaults to the commit messages since the ref. Exit 1 while look-alike matches are queued for you to declare |
| `pnpm poetics init [--write] [--json]` | Adopt Poetics in a repository: detect React and Svelte from dependencies and files, write `.poetics/config.json` scoped to each package's `src/`, ignore `.poetics/cache/`, and create units with a snapshot backfill. A dry run without `--write`; refuses a repository that already has a config. `--agents` is planned |
| `pnpm poetics backfill --snapshot [--write] [--json]` | Create a unit for every export with none, its rationale inferred from the repository's own commits, changesets, TSDoc, tests and docs, with a computed confidence ([ADR 0011](decisions/0011-backfill.md)). A dry run without `--write`; existing units are never written to, and their gaps are listed. `--history` is planned |
| `pnpm poetics hash <file>[#name] [--json]` | The indexer's `contentHash` and `interfaceHash` for a file's units, for a hand-written version |
| `pnpm poetics rehash [--write] [--agent <tool> [--model <id>]]` | Append `rehash` versions replacing provisional `git:` hashes with `b3:` ones ([ADR 0014](decisions/0014-rehash-versions.md)); a dry run without `--write`, exit 1 if any unit has unrecorded changes |
| `pnpm gate [--fetch] [--rounds N] [--seed N] [--only name]` | The phase 1 gate: scripted refactors on pinned real repositories, recorded by `poetics index` and checked uid by uid; writes `evals/gate/results.md` ([evals/gate](../evals/gate/README.md)). `--fetch` downloads the corpus first |
| `pnpm changeset` | Describe a change for the next release |

Run the demo site (Poetics on this repository) in a browser:

```bash
pnpm site:dev
```

Run the Svelte fixture in a browser:

```bash
pnpm --filter @poetics-fixtures/svelte-app dev
```

## Repository layout

```
AGENTS.md                 rules for agents and humans
GOTCHAS.md                pitfalls and workarounds (generated from notes)
.claude/skills/           poetics-orient, poetics-change, poetics-refactor, …
.poetics/
  config.json             adapters, globs, policy
  units/                  one JSON file per unit (source of truth, in git)
  notes/                  one JSON file per gotcha, workaround or invariant
  cache/index.db          SQLite index (gitignored, rebuilt)
schemas/                  JSON Schemas for unit files, config and lock
scripts/                  validate, reindex, mint-uid, gotchas, site data
packages/
  core/                   unit model, uids, hashes, graph (stubs)
  store/                  JSON store, validation, SQLite index
  adapter-react/          React detection (stub)
  adapter-svelte/         Svelte detection (stub)
  mcp/                    MCP tool definitions and the read-only stdio server
  cli/                    poetics CLI (help and changes work; the rest stubbed)
site/                     the GitHub Pages demo (Svelte)
evals/
  tasks/                  benchmark tasks
  fixtures/               sample React and Svelte apps
docs/                     this documentation, plan and decisions
```

## Your first change

1. Read [`AGENTS.md`](../AGENTS.md).
2. Make the change with unit tests.
3. Record it in `.poetics/` ([dogfooding](dogfooding.md)).
4. `pnpm preflight`.
5. `pnpm changeset` if a package's behaviour changed.
6. Commit with a Conventional Commit message.
