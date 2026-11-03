// The MCP stdio transport: newline-delimited JSON-RPC 2.0 on stdin and stdout.
// Small enough to own rather than depend on an SDK; only tools are served.
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import type { ToolDefinition } from "./tools.ts";

/** Newest first; a client asking for another version is answered with the newest. */
export const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;

const VERSION = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;

export interface StdioIo {
  input: Readable;
  output: Writable;
}

export interface ToolHost {
  tools(): readonly ToolDefinition[];
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
}

interface Request {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

class RpcError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * Serves `host`'s tools until `input` ends. A tool that throws answers with
 * `isError`, so the agent sees the message; protocol mistakes get JSON-RPC errors.
 */
export async function serveStdio(host: ToolHost, io: StdioIo): Promise<void> {
  const write = (message: object) => io.output.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
  const pending: Array<Promise<void>> = [];
  for await (const line of createInterface({ input: io.input, crlfDelay: Infinity })) {
    if (line.trim() === "") continue;
    let request: Request;
    try {
      request = JSON.parse(line) as Request;
    } catch {
      write({ id: null, error: { code: -32700, message: "Parse error" } });
      continue;
    }
    // Notifications (no id) need no answer, and the only ones a client sends here are lifecycle ones.
    if (request.id === undefined) continue;
    const id = request.id;
    pending.push(
      answer(host, request).then(
        (result) => void write({ id, result }),
        (error: unknown) =>
          void write({
            id,
            error: error instanceof RpcError ? { code: error.code, message: error.message } : { code: -32603, message: String(error) },
          }),
      ),
    );
  }
  await Promise.all(pending);
}

async function answer(host: ToolHost, request: Request): Promise<object> {
  const params = request.params ?? {};
  switch (request.method) {
    case "initialize": {
      const asked = params["protocolVersion"];
      const protocolVersion = PROTOCOL_VERSIONS.find((version) => version === asked) ?? PROTOCOL_VERSIONS[0];
      return { protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "poetics", version: VERSION } };
    }
    case "ping":
      return {};
    case "tools/list":
      return { tools: host.tools().map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) };
    case "tools/call": {
      const name = params["name"];
      if (typeof name !== "string" || !host.tools().some((tool) => tool.name === name)) {
        throw new RpcError(-32602, `Unknown tool: ${String(name)}`);
      }
      try {
        const result = await host.callTool(name, (params["arguments"] as Record<string, unknown> | undefined) ?? {});
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: (error as Error).message }], isError: true };
      }
    }
    default:
      throw new RpcError(-32601, `Method not found: ${request.method}`);
  }
}
