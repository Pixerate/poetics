import type { DatabaseSync } from "node:sqlite";
import { notImplemented } from "@poetics/core";
import { changesBetween, openIndex, rebuildIndex, storePaths } from "@poetics/store";
import { callReadTool } from "./read-tools.ts";
import { serveStdio } from "./stdio.ts";
import type { StdioIo } from "./stdio.ts";
import { TOOLS, findTool } from "./tools.ts";
import type { ToolDefinition } from "./tools.ts";

export interface ServerOptions {
  /** Repository root containing `.poetics/`. */
  root: string;
  /** Attributed on every write; filled from the MCP client's session. */
  session?: { tool: string; model?: string; session?: string; task?: string };
}

export interface PoeticsServer {
  /** The tools this server answers today; `tools/list` advertises only these. */
  tools(): readonly ToolDefinition[];
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  /** Serves MCP over stdio (or the given streams) until the input ends. */
  listen(io?: StdioIo): Promise<void>;
}

/**
 * Tools answered from the store. Impact needs the composition graph, verify the
 * indexer, signals the integrations, and the writes wait for phase 2.
 */
const SERVED = new Set([
  "poetics_changes",
  "poetics_context_pack",
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
  const server: PoeticsServer = {
    tools() {
      return TOOLS.filter((tool) => SERVED.has(tool.name));
    },
    async callTool(name, args) {
      if (!findTool(name)) throw new Error(`Unknown tool: ${name}`);
      if (!SERVED.has(name)) return notImplemented(name);
      if (name === "poetics_changes") {
        // impact needs the composition graph, which arrives with the indexer.
        if (args["impact"] === true) return notImplemented("poetics_changes impact");
        const { from, to } = args as { from?: string; to?: string };
        return changesBetween(paths, { ...(from ? { from } : {}), ...(to ? { to } : {}) });
      }
      // Incremental, so each call sees edits made since the last one at the cost of a directory read.
      db ??= openIndex(paths.indexDb);
      await rebuildIndex(paths, db);
      return callReadTool({ paths, db }, name, args);
    },
    async listen(io = { input: process.stdin, output: process.stdout }) {
      return serveStdio(server, io);
    },
  };
  return server;
}
