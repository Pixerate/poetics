# Working on Poetics with Poetics

Poetics records its own history from the first commit. Until the tools exist,
you (human or agent) write `.poetics/` by hand, following the skills in
`.claude/skills/`. Each tool, as it lands, takes over a job the skills already
describe.

| Job | Today, by hand | Taken over by | Phase |
| --- | --- | --- | --- |
| Assign identity | `pnpm mint-uid`, create the unit file | Indexer | 1 |
| Version hashes | `pnpm provisional-hash` (`git:` hashes) | Syntax-tree hashes + rehash migration | 1 |
| Gather context | Read unit files, plan and decisions | `poetics_context_pack` | 1 |
| Check the store | `pnpm validate` in CI | `poetics verify` | 1 |
| Record rationale | Append a version entry | `poetics_record_rationale` | 2 |
| Record lineage | Add a `lineage` entry | `poetics_declare_lineage` | 2 |
| Link tests | `tests` entries in the unit file | Coverage-based linking | 4 |
| Record gotchas | A note file per `poetics-gotcha`; `pnpm gotchas` | `poetics_record_note`, failure hook | 2 |

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
      "contentHash": "<pnpm provisional-hash output>",
      "provisional": true,
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

**Deleted an exported function:** append a final version whose rationale says it
was removed and why, then delete the unit file in the same commit. History stays
in git. (A tombstone format is an open question for phase 2.)

Then run `pnpm validate`.
