# CI and releases

## Workflows

| Workflow | Trigger | What it does |
| --- | --- | --- |
| [`ci.yml`](../.github/workflows/ci.yml) | Pull requests, pushes to `main` | Install, typecheck, `sv check`, unit tests, `pnpm validate`, `pnpm gotchas --check`, the Poetics change check (pull requests, against the base branch), Poetics coverage, build |
| [`release.yml`](../.github/workflows/release.yml) | Pushes to `main`, manual | Version packages, update changelogs, push to `main` and publish to npm |
| [`pages.yml`](../.github/workflows/pages.yml) | Pushes to `main`, manual | Builds the demo site from this repo's `.poetics/` and deploys it to GitHub Pages |
| [`dependabot.yml`](../.github/dependabot.yml) | Weekly (Monday) | Grouped npm and GitHub Actions updates |

All jobs run on Node 24 with pnpm from `packageManager`. `ci.yml` and
`pages.yml` start with `permissions: {}` and grant each job only what it needs.
`release.yml` has a single job, which needs `contents: write` (to push the
version commit and tags) and `id-token: write` (to publish), so it grants them
at the workflow level.

## Changesets

Every pull request that changes a package's behaviour adds a changeset:

```bash
pnpm changeset
```

Pick the packages and bump type, and write one line for the changelog. While
packages are below 1.0, use `minor` for interface changes and `patch` for
everything else. Changes that release nothing (docs, tests, CI) don't need one.

On every push to `main` (and on manual `workflow_dispatch`), `release.yml` checks
for pending changesets:

- If changesets exist, it runs `pnpm version-packages` (with `GITHUB_TOKEN`, which
  `@changesets/changelog-github` needs to link each entry to its PR), builds and tests, commits
  and pushes the version bumps and changelogs to `main` with `[skip ci]`,
  publishes the changed packages to npm with provenance, and pushes release tags.
  Releases are fully automatic; no release pull request or manual approval is needed.
- If no changesets exist, the workflow skips release.

## npm publishing with OIDC

Publishing uses npm [trusted publishing](https://docs.npmjs.com/trusted-publishers):
GitHub issues a short-lived OIDC token to the `release` job, npm exchanges it
for publish rights, and provenance is attached automatically. There is no
`NPM_TOKEN` secret; the workflow's `NPM_TOKEN` and `NODE_AUTH_TOKEN` are empty,
and the `Failed to replace env in config: ${NODE_AUTH_TOKEN}` warning they cause
is harmless.

### One-time setup (maintainers)

1. **Own the `@poetics` scope on npm** (create the organisation if needed).
2. **Leave out `"private": true`** for packages that should be published. A
   private package is versioned but never published.
3. **Bootstrap each new package.** npm trusted publishing only works for a
   package that already exists on npm: the first CI publish of a new package
   fails with `404 Not Found`. Publish its first release by hand (see
   [Publishing a package by hand](#publishing-a-package-by-hand)), or use npm's
   pending-publisher flow if it is available for your account.
4. **Add the trusted publisher** on npmjs.com for each `@poetics/*` package:
   Settings → Trusted publishing → GitHub Actions, with organisation `Pixerate`,
   repository `poetics`, and workflow filename `release.yml`. If you add a GitHub
   environment to the `release` job, enter it there too.
5. **Ensure GitHub Actions can write to the repository** (Read and write permissions
   under repository Settings → Actions → General → Workflow permissions).
6. **Enable GitHub Pages** for the demo: Settings → Pages → Source: GitHub
   Actions.
7. Optionally, create a `release` environment with required reviewers and set
   `environment: release` on the `release` job to gate every publish.

### When a release fails partway

The version commit is pushed to `main` before anything is published, so a
failed publish leaves `main` ahead of npm. Fix the cause, then run the Release
workflow by hand (Actions → Release → Run workflow, on `main`). With no pending
changesets it skips versioning, publishes only the versions npm is missing,
and pushes their tags. Tags for packages an earlier, failed run did publish are
not pushed; create them as annotated tags on the version commit
(`git tag -a @poetics/<name>@<version> -m @poetics/<name>@<version> <commit>`)
and push them.

### Publishing a package by hand

Only for a new package's first release, or when CI cannot publish. Two things
differ from CI:

- **Pack with pnpm.** Packages depend on each other with `workspace:*`.
  `pnpm pack` replaces it with the real versions; `npm publish` run in the
  package folder uploads `workspace:*` as written, and every install breaks.
  Publish the dependencies first, so the versions it pins exist on npm.
- **Turn provenance off.** Each package sets `"provenance": true` in
  `publishConfig`, which only CI can satisfy. A local publish otherwise fails
  with `Automatic provenance generation not supported for provider: null`.

```bash
pnpm build
cd packages/<name>
pnpm pack
npm publish poetics-<name>-<version>.tgz --access public --provenance=false
rm poetics-<name>-<version>.tgz
```

If `--provenance=false` does not override `publishConfig`, remove the
`provenance` line from that package's `package.json` before `pnpm pack`, and
restore it afterwards without committing the change. Then check the published
dependencies (`npm view @poetics/<name>@<version> dependencies`) and add the
package's trusted publisher, so later releases come from CI.

## Dependabot

Dependabot opens grouped pull requests once a week: one for npm development
dependencies, one for production dependencies, and one for GitHub Actions.
They run CI like any other PR. Dependency bumps that change a published
package's behaviour need a changeset added by a maintainer.

## Running CI locally

```bash
pnpm preflight
```
