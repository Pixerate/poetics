---
"@poetics/adapter-svelte": minor
"@poetics/adapter-typescript": minor
"@poetics/cli": minor
"@poetics/store": patch
"@poetics/mcp": patch
---

Track functions declared in a Svelte component's `<script>` and `<script module>` as child units owned by the component (#72). Each has its own content hash, taken from the function as written, and its own interface and edges from the checker. An edit to one records a version of it and of its component, and the component's version lists its children's hashes in `deps`. Detected and indexed units gain `owner`; a component's edges no longer include what its script functions use; drift, the MCP code view and `poetics index` now include owned units; `relocateUnit` sets or clears the owner when a unit moves.
