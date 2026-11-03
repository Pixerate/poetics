---
"@poetics/adapter-typescript": minor
---

Add the TypeScript indexer. It detects exported functions, hooks and types; computes content, runtime and interface hashes over normalised syntax trees; and resolves cross-file edges through the type checker. A reused program and a per-file cache skip unchanged files. `createTypeScriptAdapter` exposes it through `FrameworkAdapter`.
