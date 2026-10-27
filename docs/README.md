# Developer documentation

Start with [Getting started](getting-started.md), then read the guide for the
area you are changing.

| Guide | What it covers |
| --- | --- |
| [Getting started](getting-started.md) | Prerequisites, install, the everyday commands |
| [Architecture](architecture.md) | Packages, how data flows, what is built and what is stubbed |
| [Data model and store](data-model.md) | Units, versions, hashes, the JSON files and the SQLite index |
| [Working on Poetics with Poetics](dogfooding.md) | Recording your own changes in `.poetics/` by hand |
| [Agents: skills and MCP](agents.md) | The skills in `.claude/skills/` and the planned MCP tools |
| [Change checks and coverage](checks-and-coverage.md) | `poetics:check` on every change, `poetics:coverage` for the codebase |
| [Testing](testing.md) | Unit tests, browser checks, fixtures and evals |
| [CI and releases](ci-and-releases.md) | GitHub Actions, Changesets, Dependabot, npm trusted publishing |
| [Demo site](demo.md) | The GitHub Pages site that shows Poetics on its own codebase |
| [Plan](plan.md) | The full design, kept current |
| [Decisions](decisions/README.md) | Why things are the way they are |

Repository-wide rules for humans and agents are in [`AGENTS.md`](../AGENTS.md);
known pitfalls are in [`GOTCHAS.md`](../GOTCHAS.md).
