---
"@poetics/core": minor
"@poetics/store": minor
"@poetics/cli": minor
"@poetics/mcp": patch
---

Run out-of-process adapters (ADR 0025). An `adapters` entry can be a command adapter, `{ name, command, include, timeoutSeconds }`, run once per batch with the adapter protocol on stdin and stdout. Its files go to it alone, a failing or malformed response stops the run with nothing written, and files it cannot read keep their units. `Framework` gains `swiftui` and `EdgeKind` gains `conforms-to` (ADR 0026). `adapterResponseProblems` checks a response's shape without loading the schemas, and the store gains `commandAdapterFor`, `commandAdapters` and `typescriptReads`. `checkChange` now reads code through the adapters too.
