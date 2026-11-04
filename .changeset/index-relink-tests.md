---
"@poetics/store": minor
"@poetics/cli": minor
---

`poetics index` now follows test files git saw renamed since `--since`: it rewrites each live unit's `tests[].file` to the new path, moved unit or not, shows it as `= <unit> tests: <from> -> <to>` with a `relinked` count, and includes `relinks` in `--json`. Adds the `relinkTests` store writer.
