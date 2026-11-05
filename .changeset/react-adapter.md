---
"@poetics/adapter-typescript": minor
"@poetics/adapter-react": minor
"@poetics/store": minor
"@poetics/cli": minor
"@poetics/mcp": minor
---

Add the React adapter. `reactPlugin` plugs into the TypeScript indexer through a new `FrameworkPlugin` interface. It detects components (PascalCase functions that return JSX, or are wrapped in `memo`, `forwardRef` or `lazy`) and hooks, gives components their props, default prop values and forwarded ref as their interface, and records JSX tags as `renders` edges. `createReactAdapter` now takes the indexer's options. The CLI and MCP server run the plugin when `.poetics/config.json` lists `react` in `adapters`. `poetics init` now reads tsconfig files with TypeScript's own parser, so `paths` entries such as `"@/*"` no longer break it.
