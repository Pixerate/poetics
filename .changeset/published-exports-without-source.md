---
"@poetics/core": patch
"@poetics/store": patch
"@poetics/mcp": patch
"@poetics/cli": patch
"@poetics/adapter-react": patch
"@poetics/adapter-svelte": patch
---

Published `exports` no longer include the `poetics-source` condition, which pointed at `src/index.ts`, a file the packages don't ship. Consumers running with `--conditions=poetics-source` now resolve to `dist/` instead of failing.
