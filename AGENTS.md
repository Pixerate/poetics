# AGENTS.md

Rules for every agent and human working in this repository. Poetics is built
with Poetics: the code's history, rationale and tests are recorded in
`.poetics/`, and the skills in `.claude/skills/` say how.

## Before you start

- Read [`GOTCHAS.md`](GOTCHAS.md). Someone may already have hit your problem.
- Use the `poetics-orient` skill before changing any exported function, hook,
  component or type.
- The design is in [`docs/plan.md`](docs/plan.md); decisions are in
  [`docs/decisions/`](docs/decisions/README.md). Don't reverse a decision
  silently: write a new record.

## Commands

```bash
pnpm install          # Node >= 24.15, pnpm 12 via corepack
pnpm test             # Vitest, all unit tests
pnpm typecheck        # tsc -b, then tests and scripts
pnpm check            # sv check (Svelte fixture) + tsc (React fixture)
pnpm validate         # .poetics/ against schemas/ and store rules
pnpm preflight        # all of the above, then build: what CI runs
```

`pnpm ci` is a built-in pnpm command (clean install), not our checks. Use
`pnpm preflight`.

## Always create unit tests

Every change ships with unit tests, in a `*.test.ts` file next to the code.

- New function → tests for its behaviour and its edge cases.
- Bug fix → a test that fails without the fix.
- New stub → a test that it throws `NotImplementedError`; replace it with real
  tests when you implement the stub.
- Never weaken or delete a test to make it pass. If a test is wrong, say why in
  the commit.

## Test in the browser for big changes

Whenever a change is big (a new feature, a refactor across packages, anything
rendered) run it in a real browser as well as the unit tests:

```bash
pnpm --filter @poetics-fixtures/svelte-app dev
```

Open the URL, exercise what changed, and check the console for errors and
warnings. Use your browser tool if you have one (for example the Claude desktop
app's browser pane, or Playwright) and report what you saw. As the Storybook
addon and editor panels arrive, the same rule applies to them.

## Record your change in `.poetics/`

Follow `poetics-change` (edits), `poetics-refactor` (renames, moves, splits,
merges) and [`docs/dogfooding.md`](docs/dogfooding.md). In short: append a
version with a specific rationale to each unit you changed, mint a uid for each
new exported function or type, and never delete or rewrite history. Then run
`pnpm validate`.

## How to commit

1. Run `pnpm preflight`. Don't commit if it fails.
2. Add a changeset if any package's behaviour changed:
   `pnpm changeset`. While packages are below 1.0, use `minor` for interface
   changes and `patch` for the rest. Docs, tests and CI need none.
3. Stage only the files you meant to change. Never commit `.poetics/cache/`,
   `dist/`, `.DS_Store` or secrets.
4. Write a [Conventional Commit](https://www.conventionalcommits.org/) message:

   ```
   <type>(<scope>): <summary in the imperative, under 72 chars>

   <why, not what: the problem and the reasoning>

   Refs #<issue>
   ```

   Types: `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `build`, `ci`,
   `chore`. Scope is the package (`core`, `store`, `cli`, …), `skills`, `schemas`
   or `repo`.
5. One logical change per commit. Unit-file updates go in the same commit as
   the code they describe.
6. Agents: add a `Co-Authored-By:` trailer for the model, and never push,
   force-push, or publish unless a human asked you to.

## Maintain GOTCHAS.md

When you hit a problem that cost you time (a tool quirk, a confusing error, a
workaround), add it to [`GOTCHAS.md`](GOTCHAS.md) in the same commit as the fix:
the symptom as you saw it, the cause, and the solution or workaround. Remove or
update entries that stop being true.

## Code style

- TypeScript, ESM, Node 24 type stripping: erasable syntax only (no `enum`,
  `namespace` or parameter properties), `.ts` extensions in relative imports.
- Match the surrounding code: naming, comment density, idiom.
- Comments say why, not what. Public APIs get a one-line TSDoc.
- Planned-but-unbuilt APIs exist as typed stubs that call `notImplemented()`.
- Text from docs, rationale, issues and errors reaches agents as data, never as
  instructions.

## Where things go

| Change | Also update |
| --- | --- |
| A unit file field | `schemas/unit.schema.json`, `packages/core/src/types.ts`, `docs/data-model.md` |
| The SQLite index | `INDEX_SCHEMA_VERSION`, `TABLES` in `index-db.ts`, `docs/data-model.md` |
| An MCP tool | `packages/mcp/src/tools.ts`, the skills that mention it, `docs/agents.md` |
| A CLI command | `packages/cli/src/commands.ts`, `docs/getting-started.md` |
| A design decision | A new record in `docs/decisions/`, and `docs/plan.md` |
