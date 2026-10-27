# Getting started

## Prerequisites

- **Node.js 24.15 or newer.** `.nvmrc` pins the major; `engine-strict` refuses
  older versions. Node runs the TypeScript scripts directly (type stripping) and
  provides the built-in `node:sqlite` module.
- **pnpm 12.** The version is pinned in `package.json` (`packageManager`);
  `corepack enable` picks it up.
- **git**, for provisional hashes and history.

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
| `pnpm validate` | Validate `.poetics/` against `schemas/` and the store rules |
| `pnpm build` | Build every package to `dist/` |
| `pnpm preflight` | Everything CI runs, in order |
| `pnpm reindex [--fresh]` | Rebuild the local SQLite index at `.poetics/cache/index.db` |
| `pnpm mint-uid [count]` | Print new unit uids for hand-written unit files |
| `pnpm provisional-hash <file> <start> <end>` | Provisional hash of a declaration's lines |
| `pnpm changeset` | Describe a change for the next release |

Run the Svelte fixture in a browser:

```bash
pnpm --filter @poetics-fixtures/svelte-app dev
```

## Repository layout

```
AGENTS.md                 rules for agents and humans
GOTCHAS.md                pitfalls and workarounds
.claude/skills/           poetics-orient, poetics-change, poetics-refactor, …
.poetics/
  config.json             adapters, globs, policy
  units/                  one JSON file per unit (source of truth, in git)
  cache/index.db          SQLite index (gitignored, rebuilt)
schemas/                  JSON Schemas for unit files, config and lock
scripts/                  validate, reindex, mint-uid, provisional-hash
packages/
  core/                   unit model, uids, hashes, graph (stubs)
  store/                  JSON store, validation, SQLite index
  adapter-react/          React detection (stub)
  adapter-svelte/         Svelte detection (stub)
  mcp/                    MCP tool definitions and server (stub)
  cli/                    poetics CLI (help works; commands stubbed)
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
