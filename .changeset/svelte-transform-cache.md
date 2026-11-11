---
"@poetics/adapter-typescript": patch
---

Stop re-running a plugin's transform, such as svelte2tsx, on unchanged files (#66). The indexer's cache keeps each file's imports and whether it changes globals, and a re-index checks only the files that changed, what they import and the files that declare globals. Results are unchanged; on a 2,128-component Svelte repository a re-index after a small refactor takes a third of the time. The cache format changes, so the first index after upgrading is a full one.
