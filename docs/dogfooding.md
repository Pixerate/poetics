# Working on Poetics with Poetics

Poetics records its own history from the first commit. Until the tools exist,
you (human or agent) write `.poetics/` by hand, following the skills in
`.claude/skills/`. Each tool, as it lands, takes over a job the skills already
describe.

| Job | Today, by hand | Taken over by | Phase |
| --- | --- | --- | --- |
| Assign identity | `pnpm poetics index --write` (or `pnpm mint-uid` and a unit file by hand) | Post-commit hook | 1 |
| Version hashes | `pnpm poetics hash <file>#<name>` (`b3:` hashes; done, ADR 0014) | `poetics index` | 1 |
| Gather context | Read unit files, plan and decisions | `poetics_context_pack` | 1 |
| Check the store | `pnpm validate` in CI | `poetics verify` | 1 |
| Check a change was recorded | `pnpm poetics:check` in preflight and on pull requests | `poetics verify --since`, GitHub Action | 1, 5 |
| Measure coverage | `pnpm poetics:coverage` with `policy.coverage` | `poetics coverage` | 1 |
| Record rationale | `pnpm poetics index --write`, then `poetics_record_rationale` per unit (or edit the version) | Done | 2 |
| Record lineage | `pnpm poetics index`; `poetics_declare_lineage` for what it queues, splits and merges | Done | 2 |
| Link tests | `tests` entries in the unit file | Coverage-based linking | 4 |
| Record gotchas | `poetics_record_note` (or a note file and `pnpm gotchas`) | Failure hook | 2 |

## What gets a unit

Every **exported function and exported type or interface** in
`packages/*/src` and `scripts/` (tests and `index.ts` barrels excluded).
Constants and classes are not units. Fixture apps get units once the adapters
can index them.

## Recipes

**Changed a function's body:** append a `behaviour` version. See
[`poetics-change`](../.claude/skills/poetics-change/SKILL.md).

**Added an exported function:**

```bash
pnpm mint-uid
```

Then create `.poetics/units/<uid>.json`:

```json
{
  "$schema": "../../schemas/unit.schema.json",
  "uid": "<uid>",
  "kind": "function",
  "framework": "none",
  "name": "formatPrice",
  "location": { "file": "packages/core/src/format.ts" },
  "versions": [
    {
      "contentHash": "<contentHash from pnpm poetics hash>",
      "interfaceHash": "<interfaceHash from pnpm poetics hash>",
      "parent": null,
      "change": "created",
      "actor": { "kind": "agent", "tool": "claude-code", "model": "<model id>", "reviewed": false },
      "rationale": "Why this exists, citing the issue, task or plan section.",
      "links": [{ "kind": "plan", "ref": "docs/plan.md#core-model" }]
    }
  ],
  "tests": [{ "file": "packages/core/src/format.test.ts", "via": "static" }]
}
```

Humans use `"actor": { "kind": "human" }`.

**Renamed or moved something:** keep the uid; see
[`poetics-refactor`](../.claude/skills/poetics-refactor/SKILL.md).

**Deleted an exported function:** keep the unit file and append a final version
with `"change": "removed"`, `"contentHash": "git:e69de29bb2d1d6434b8b29ae775ad8c2e48c5391"`
(the empty-blob hash), `"provisional": true`, and a rationale saying why it went
and what replaces it, if anything. Never delete the unit file
([ADR 0010](decisions/0010-removed-versions.md)).

Then run `pnpm validate` and `pnpm poetics:check`; see
[Change checks and coverage](checks-and-coverage.md).
