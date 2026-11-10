---
"@poetics/core": minor
"@poetics/cli": minor
---

`poetics backfill` collects pull request evidence (ADR 0011). Pull requests named in merge and squash subjects are linked as `github-pr`, no longer as issues. With a GitHub token (`GITHUB_TOKEN` or `gh auth token`) and an `origin` on github.com, both modes also link the pull requests containing each commit and the issues they close, and raise a version's confidence when a pull request names the unit or a review comment falls on its lines. Pull request and issue text is never written to `.poetics/`; responses are cached in `.poetics/cache/github.json`, a rate limit stops the collectors without failing the backfill, and `--offline` makes no calls. `@poetics/core` adds the `IssueTracker` interface, and a history walk leaves recorded prehistory alone when new evidence would change it.
