# CI and releases

## Workflows

| Workflow | Trigger | What it does |
| --- | --- | --- |
| [`ci.yml`](../.github/workflows/ci.yml) | Pull requests, pushes to `main` | Install, typecheck, `sv check`, unit tests, `pnpm validate`, `pnpm gotchas --check`, the Poetics change check (pull requests, against the base branch), Poetics coverage, build |
| [`release.yml`](../.github/workflows/release.yml) | Pushes to `main`, manual | Version packages, update changelogs, push to `main` and publish to npm |
| [`pages.yml`](../.github/workflows/pages.yml) | Pushes to `main`, manual | Builds the demo site from this repo's `.poetics/` and deploys it to GitHub Pages |
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

On every push to `main` (and on manual `workflow_dispatch`), `release.yml` checks
for pending changesets:

- If changesets exist, it runs `pnpm version-packages`, builds and tests, commits
  and pushes the version bumps and changelogs to `main` with `[skip ci]`,
  publishes the changed packages to npm with provenance, and pushes release tags.
  Releases are fully automatic; no release pull request or manual approval is needed.
- If no changesets exist, the workflow skips release.

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
5. **Ensure GitHub Actions can write to the repository** (Read and write permissions
   under repository Settings → Actions → General → Workflow permissions).
6. **Enable GitHub Pages** for the demo: Settings → Pages → Source: GitHub
   Actions.
7. Optionally, create a `release` environment with required reviewers and set
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
