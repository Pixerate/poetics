# CI and releases

## Workflows

| Workflow | Trigger | What it does |
| --- | --- | --- |
| [`ci.yml`](../.github/workflows/ci.yml) | Pull requests, pushes to `main` | Install, typecheck, `sv check`, unit tests, `pnpm validate`, build |
| [`release.yml`](../.github/workflows/release.yml) | Pushes to `main` | Changesets: open/update the "Version Packages" PR, or publish to npm |
| [`dependabot.yml`](../.github/dependabot.yml) | Weekly (Monday) | Grouped npm and GitHub Actions updates |

All jobs run on Node 24 with pnpm from `packageManager`. Workflows start with
`permissions: {}` and grant each job only what it needs.

## Changesets

Every pull request that changes a package's behaviour adds a changeset:

```bash
pnpm changeset
```

Pick the packages and bump type, and write one line for the changelog. While
packages are below 1.0, use `minor` for interface changes and `patch` for
everything else. Changes that release nothing (docs, tests, CI) don't need one.

On every push to `main`, `release.yml` picks a mode:

- **version** — changesets exist. It runs `changeset version`, which bumps
  versions and writes changelogs, and opens or updates a "Version Packages" PR.
- **publish** — no pending changesets, but some package version is not on npm.
  It builds, packs and publishes them, then creates git tags and GitHub releases.
- **none** — nothing to do.

Merging the "Version Packages" PR is how a release happens.

## npm publishing with OIDC

Publishing uses npm [trusted publishing](https://docs.npmjs.com/trusted-publishers):
GitHub issues a short-lived OIDC token to the `publish` job, npm exchanges it for
publish rights, and provenance is attached automatically. There is no
`NPM_TOKEN` secret. Only the `publish` job has `id-token: write`.

### One-time setup (maintainers)

1. **Own the `@poetics` scope on npm** (create the organisation if needed).
2. **Remove `"private": true`** from each package's `package.json` when it is
   ready to publish. Today every package is private, so `release.yml` versions
   them but publishes nothing.
3. **Bootstrap each package.** npm trusted publishing is configured per
   package, and a package must exist first. Publish `0.0.0` (or the first
   release) manually once from a maintainer's machine, or use npm's
   pending-publisher flow if it is available for your account.
4. **Add the trusted publisher** on npmjs.com for each `@poetics/*` package:
   Settings → Trusted publishing → GitHub Actions, with organisation `Pixerate`,
   repository `poetics`, and workflow filename `release.yml`. If you add a GitHub
   environment to the `publish` job, enter it there too.
5. **Allow Actions to create pull requests:** repository Settings → Actions →
   General → "Allow GitHub Actions to create and approve pull requests".
6. Optionally, create a `release` environment with required reviewers and set
   `environment: release` on the `publish` job to gate every publish.

## Dependabot

Dependabot opens grouped pull requests once a week: one for npm development
dependencies, one for production dependencies, and one for GitHub Actions.
They run CI like any other PR. Dependency bumps that change a published
package's behaviour need a changeset added by a maintainer.

## Running CI locally

```bash
pnpm preflight
```
