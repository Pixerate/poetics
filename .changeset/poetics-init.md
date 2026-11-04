---
"@poetics/cli": minor
---

Add `poetics init`. It detects React and Svelte from the dependencies of the root and each workspace package (or from `.tsx` and `.svelte` files), writes `.poetics/config.json` scoped to each package's source, adds `.poetics/cache/` to `.gitignore`, and creates units with a snapshot backfill. It is a dry run without `--write`, and refuses a repository that already has a config. Snapshot backfill is also much faster on large repositories.
