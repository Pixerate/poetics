---
"@poetics/adapter-react": minor
"@poetics/adapter-typescript": minor
---

The React adapter claims class components: classes that extend `Component` or `PureComponent`, bare or as `React.X`. Their interface is the props type argument and `static defaultProps`, and JSX in them records `renders` edges. The TypeScript indexer reads exported classes and keeps one only when a framework plugin claims it, so plain classes stay untracked; `FrameworkPlugin.claim` and `signature` may be called without a function for a class.
