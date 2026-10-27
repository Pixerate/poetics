# Testing

## Unit tests

Every change ships with unit tests. Vitest runs every `*.test.ts` under
`packages/*/src` and `scripts/`.

```bash
pnpm test
```

```bash
pnpm vitest run packages/store
```

Conventions:

- Tests sit next to the code: `foo.ts` and `foo.test.ts`.
- Test files import source with `.ts` extensions, and workspace packages
  resolve to source through the `poetics-source` condition, so no build is
  needed.
- Stubs get a test asserting they throw `NotImplementedError`. When you
  implement one, replace that assertion with real behaviour tests.
- File-system tests build throwaway repos in the OS temp folder (see
  `packages/store/src/test-helpers.ts`). Never write into the working tree.
- Prefer exact assertions (`toEqual`) over snapshots for structured output.
- Tests are linked from unit files (`tests` with `via: "static"`).
- When a test exists to catch a gotcha, point the note's `check` at it.

## Type checks

```bash
pnpm typecheck
```

```bash
pnpm check
```

`pnpm check` runs `sv check` on the Svelte fixture and `tsc` on the React
fixture.

## Browser checks

Test in a browser whenever a change is big or touches anything rendered: the
fixture apps, and later the Storybook addon and editor panels. Unit tests
do not catch a component that compiles but renders wrong.

```bash
pnpm site:dev
```

```bash
pnpm --filter @poetics-fixtures/svelte-app dev
```

Open the printed URL, exercise what you changed, and check the console for
errors. Agents with a browser tool (for example the Claude desktop app's browser
pane, or Playwright) should do the same and report what they saw.

## Evals

`evals/tasks/` holds benchmark tasks; `evals/fixtures/` the apps they run
against. The harness is planned for phase 1. Until then, keep task files and
fixtures in sync when you change either.
