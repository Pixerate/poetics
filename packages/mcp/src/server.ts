import { notImplemented } from "@poetics/core";
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

/** The stdio MCP server. Tool calls are routed here once the store and indexer land. */
export function createServer(_options: ServerOptions): PoeticsServer {
  return {
    async callTool(name) {
      if (!findTool(name)) throw new Error(`Unknown tool: ${name}`);
      return notImplemented(name);
    },
    async listen() {
      return notImplemented("createServer().listen");
    },
  };
}
