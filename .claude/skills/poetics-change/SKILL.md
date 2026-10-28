---
name: poetics-change
description: Use when editing a function, hook, component or type in a Poetics repo, to classify the change, update tests and docs, and record per-unit rationale in .poetics/units.
---

# Change a unit and record why

Run `poetics-orient` first. Day-one version: you edit unit files by hand. When
`poetics_record_rationale` lands, step 5 becomes a call to it.

1. **Make the code change**, and add or update unit tests for it. Every change
   ships with tests (see `AGENTS.md`).
2. **Classify it** for each unit you touched:
   - `interface` — the public signature changed (parameters, return type,
     props, events, snippets, default prop values). Breaking for callers.
   - `behaviour` — the body changed in a way that can alter results.
   - `cosmetic` — types or docs only.
   - `removed` — the export was deleted. Keep the unit file; see step 5.
   Formatting and comment-only edits are not a new version; skip steps 4–5.
3. **Handle callers** for `interface` changes: update every unit that depends on
   this one, and give each of those its own version entry.
4. **Compute the provisional hash** of the unit's new source text, the whole
   declaration from `export` to its closing brace:
   `pnpm provisional-hash <file> <startLine> <endLine>` (1-based, inclusive).
   It prints a `git:` hash: the git blob hash of that text.
5. **Append a version** to `.poetics/units/<uid>.json`. Never edit or remove
   earlier entries.

   ```json
   {
     "contentHash": "git:<new hash>",
     "provisional": true,
     "parent": "<previous version's contentHash>",
     "change": "behaviour",
     "actor": { "kind": "agent", "tool": "claude-code", "model": "<your model id>", "reviewed": false },
     "rationale": "<one or two sentences: what changed for this unit and why>",
     "links": [{ "kind": "github-issue", "ref": "#123" }]
   }
   ```

   Rationale describes this unit's change, not the whole commit, and cites
   where it came from: an issue, the task, a decision record or the plan.
6. **Update `docs`** on the unit if its behaviour or interface changed, and the
   matching TSDoc or `<!-- @component -->` comment in source.
7. **New units** (a new exported function, hook, component or type): mint a uid
   with `pnpm mint-uid`, create `.poetics/units/<uid>.json` with a single
   `"change": "created"` version and `"parent": null`, and link its tests.
8. **Notes:** if `pnpm validate` warns that a note anchored to a unit you
   changed needs re-checking, confirm it still holds and set its `observedAt`
   to the new `contentHash`, or retire it (`poetics-gotcha`). If the change hit
   a pitfall that cost you time, record it with `poetics-gotcha`.
9. **Check**: `pnpm validate`, `pnpm poetics:check` and `pnpm test`.
   `poetics:check` prints the line range and new hash for any export whose
   unit is missing or behind, so you can fix each finding directly.
