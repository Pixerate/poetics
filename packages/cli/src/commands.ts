export interface CommandSpec {
  name: string;
  usage: string;
  summary: string;
}

/** The CLI surface from docs/plan.md, "Developer workflow and tooling". */
export const COMMANDS: readonly CommandSpec[] = [
  { name: "init", usage: "poetics init [--agents]", summary: "Detect React and Svelte, write config, index the repo and backfill history from git" },
  { name: "index", usage: "poetics index", summary: "Incremental re-index of changed files; run by the git hook" },
  { name: "log", usage: "poetics log <unit>", summary: "Version history of one unit, with rationale and commits" },
  { name: "why", usage: "poetics why <unit>", summary: "The rationale chain that led to the current version" },
  { name: "impact", usage: "poetics impact [ref]", summary: "Components whose closure changed since a branch or commit" },
  { name: "diff", usage: "poetics diff <unit> <a> <b>", summary: "Semantic diff between two versions of a unit" },
  { name: "verify", usage: "poetics verify", summary: "List unverified units, stale docs and unresolved edges; non-zero exit for CI" },
  { name: "docs", usage: "poetics docs sync", summary: "Write stored docs into TSDoc and @component comments" },
];
