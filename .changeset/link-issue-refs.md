---
"@poetics/cli": patch
---

`poetics index` links each commit's issue references (`#N`, `owner/repo#N`) to the versions of units in the files that commit touched, instead of giving every version in the range every reference. References in an explicit `--rationale` still go on every version.
