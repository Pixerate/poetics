import type { DatabaseSync } from "node:sqlite";
import { notImplemented } from "@poetics/core";
import type { Actor } from "@poetics/core";
import { createGitHubTracker, githubRepoOf, githubToken } from "@poetics/cli";
import { changesBetween, openIndex, parseUnit, readUnitFiles, rebuildIndex, storePaths } from "@poetics/store";
import { codeView } from "./code.ts";
import type { CodeView } from "./code.ts";
import type { TrackerAccess } from "./issues.ts";
import { callReadTool, changedUnits, impactReport } from "./read-tools.ts";
import { serveStdio } from "./stdio.ts";
import type { StdioIo } from "./stdio.ts";
import { TOOLS, findTool } from "./tools.ts";
import type { ToolDefinition } from "./tools.ts";
import { callWriteTool } from "./write-tools.ts";

export interface ServerOptions {
  /** Repository root containing `.poetics/`. */
  root: string;
  /** Attributed on every write; filled from the MCP client's session. */
  session?: { tool: string; model?: string; session?: string; task?: string };
  /**
   * The issue tracker for `poetics_signals` and issue-driven context packs.
   * Defaults to GitHub when `origin` is on github.com and a token is found
   * (`GITHUB_TOKEN`, else `gh auth token`); `false` turns it off.
   */
  tracker?: false | (() => TrackerAccess | Promise<TrackerAccess>);
}

export interface PoeticsServer {
  /** The tools this server answers today; `tools/list` advertises only these. */
  tools(): readonly ToolDefinition[];
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  /** Called with the MCP client's `clientInfo` when it connects: names the agent writes are attributed to. */
  connect(client: { name: string; version?: string }): void;
  /** Serves MCP over stdio (or the given streams) until the input ends. */
  listen(io?: StdioIo): Promise<void>;
}

/** Tools answered from the store, the code and the issue tracker. Links to tests and docs come later. */
const SERVED = new Set([
  "poetics_signals",
  "poetics_record_rationale",
  "poetics_declare_lineage",
  "poetics_record_note",
  "poetics_changes",
  "poetics_context_pack",
  "poetics_impact",
  "poetics_verify",
  "poetics_search",
  "poetics_unit",
  "poetics_history",
  "poetics_tests_for",
  "poetics_notes",
]);

/** The stdio MCP server. Tool calls are routed here as the store and indexer land. */
export function createServer(options: ServerOptions): PoeticsServer {
  const paths = storePaths(options.root);
  let db: DatabaseSync | undefined;
  // One view per tool call at most: the indexer's cache keeps it cheap, and each call sees the code as it is now.
  const code = async (): Promise<CodeView> => codeView(options.root, (await readUnitFiles(paths)).map(parseUnit));
  // The token is looked up once; the tracker is made per call and caches nothing, so issue states are read fresh.
  let token: string | null | undefined;
  const github = (): TrackerAccess => {
    const repo = githubRepoOf(options.root);
    if (!repo) return { unavailable: "the repository has no origin on github.com" };
    token ??= githubToken() ?? null;
    if (!token) return { repo, unavailable: "no GitHub token: set GITHUB_TOKEN or run gh auth login" };
    return { repo, tracker: createGitHubTracker({ repo, token }) };
  };
  const tracker = async (): Promise<TrackerAccess> =>
    options.tracker === false ? { unavailable: "the issue tracker is turned off for this server" } : (options.tracker ?? github)();
  let client: string | undefined;
  // Every write is an agent's, unreviewed until a person approves it, as the plan's provenance rules say.
  const actor = (): Actor => {
    const session = options.session ?? { tool: client ?? "mcp-client" };
    return {
      kind: "agent",
      tool: session.tool,
      ...(session.model ? { model: session.model } : {}),
      ...(session.session ? { session: session.session } : {}),
      ...(session.task ? { task: session.task } : {}),
      reviewed: false,
    };
  };
  const server: PoeticsServer = {
    tools() {
      return TOOLS.filter((tool) => SERVED.has(tool.name));
    },
    async callTool(name, args) {
      if (!findTool(name)) throw new Error(`Unknown tool: ${name}`);
      if (!SERVED.has(name)) return notImplemented(name);
      // Incremental, so each call sees edits made since the last one at the cost of a directory read.
      db ??= openIndex(paths.indexDb);
      await rebuildIndex(paths, db);
      let view: Promise<CodeView> | undefined;
      let access: Promise<TrackerAccess> | undefined;
      const ctx = { paths, db, code: () => (view ??= code()), tracker: () => (access ??= tracker()) };
      if (name === "poetics_changes") {
        const { from, to } = args as { from?: string; to?: string };
        const set = await changesBetween(paths, { ...(from ? { from } : {}), ...(to ? { to } : {}) });
        if (args["impact"] !== true) return set;
        const { changed, interfaceChanged } = changedUnits(set);
        return { ...set, impact: impactReport(ctx, await ctx.code(), changed, interfaceChanged) };
      }
      if (findTool(name)!.access === "write") return callWriteTool({ ...ctx, actor: actor() }, name, args);
      return callReadTool(ctx, name, args);
    },
    connect(info) {
      client = info.name;
    },
    async listen(io = { input: process.stdin, output: process.stdout }) {
      return serveStdio(server, io);
    },
  };
  return server;
}
