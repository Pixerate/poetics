# The demo site

`site/` is a static Svelte app that shows Poetics running on its own codebase.
It is published to GitHub Pages at <https://pixerate.github.io/poetics/> on
every push to `main`.

Everything it shows is read from the repository at build time, so it is always
the committed state:

| Page | Shows |
| --- | --- |
| Overview | Coverage from `pnpm poetics:coverage` against the policy minimums, per-area breakdown, recent versions, decision records |
| Units | Every unit: search across names, files, docs and rationale; current source; version timeline with change class, rationale, agent provenance and links; lineage; tests; dependents; anchored gotchas; the raw unit file an agent reads |
| Gotchas | The notes behind `GOTCHAS.md`, with a "paste an error" lookup that sketches the planned `poetics_notes` tool |

## How it is built

1. `scripts/export-site-data.ts` (`pnpm site:data`) gathers units, notes,
   coverage, decision records, the current source of each declaration and the
   commit, and writes `site/public/data.json` (gitignored). `buildSiteData` in
   `scripts/lib/site-data.ts` does the shaping and is unit-tested.
2. Vite builds `site/` with a relative base (`./`), so the same output works at
   `/poetics/` on Pages and locally. Routing is hash-based (`#/units/<uid>`).
3. `.github/workflows/pages.yml` builds it and deploys with
   `actions/deploy-pages`.

`site/src/lib/types.ts` is the contract between the export and the site. The
site never imports Node-only code; search and note matching live in
`site/src/lib/query.ts` and are unit-tested.

## Working on it

```bash
pnpm site:dev
```

This regenerates `data.json` and starts Vite. It is a rendered app, so test
changes in a browser (desktop, a phone-width viewport and dark mode) as well as
with `pnpm test` and `pnpm check`.

## One-time setup

In the repository settings, under **Pages**, set **Source** to **GitHub
Actions**. Until then the deploy job fails.
