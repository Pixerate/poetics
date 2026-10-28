import { notImplemented } from "@poetics/core";
import { changesBetween, storePaths } from "@poetics/store";
import { findTool } from "./tools.ts";

export interface ServerOptions {
  /** Repository root containing `.poetics/`. */
  root: string;
  /** Attributed on every write; filled from the MCP client's session. */
  session?: { tool: string; model?: string; session?: string; task?: string };
}

export interface PoeticsServer {
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  listen(): Promise<void>;
}

/** The stdio MCP server. Tool calls are routed here as the store and indexer land. */
export function createServer(options: ServerOptions): PoeticsServer {
  return {
    async callTool(name, args) {
      if (!findTool(name)) throw new Error(`Unknown tool: ${name}`);
      if (name === "poetics_changes") {
        // impact needs the composition graph, which arrives with the indexer.
        if (args["impact"] === true) return notImplemented("poetics_changes impact");
        const { from, to } = args as { from?: string; to?: string };
        return changesBetween(storePaths(options.root), { ...(from ? { from } : {}), ...(to ? { to } : {}) });
      }
      return notImplemented(name);
    },
    async listen() {
      return notImplemented("createServer().listen");
    },
  };
}
