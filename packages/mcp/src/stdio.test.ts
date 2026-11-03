import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSIONS, serveStdio } from "./stdio.ts";
import type { ToolHost } from "./stdio.ts";
import { findTool } from "./tools.ts";

const host: ToolHost = {
  tools: () => [findTool("poetics_search")!],
  async callTool(_name, args) {
    if (args["query"] === "fail") throw new Error("query failed");
    return { units: [], query: args["query"] };
  },
};

/** Sends each message as one line, closes stdin, and returns the parsed replies. */
async function exchange(...lines: Array<object | string>): Promise<Array<Record<string, unknown>>> {
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks: string[] = [];
  output.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));
  const done = serveStdio(host, { input, output });
  for (const line of lines) input.write(`${typeof line === "string" ? line : JSON.stringify(line)}\n`);
  input.end();
  await done;
  return chunks.join("").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("serveStdio", () => {
  it("negotiates the protocol version and ignores notifications", async () => {
    const replies = await exchange(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {} } },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } },
      { jsonrpc: "2.0", id: 3, method: "ping" },
    );
    expect(replies).toEqual([
      { jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "poetics", version: expect.any(String) } } },
      { jsonrpc: "2.0", id: 2, result: expect.objectContaining({ protocolVersion: PROTOCOL_VERSIONS[0] }) },
      { jsonrpc: "2.0", id: 3, result: {} },
    ]);
  });

  it("lists only the host's tools, with their schemas", async () => {
    const [reply] = await exchange({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const tools = (reply!["result"] as { tools: Array<{ name: string; inputSchema: object }> }).tools;
    expect(tools.map((tool) => tool.name)).toEqual(["poetics_search"]);
    expect(tools[0]!.inputSchema).toEqual(findTool("poetics_search")!.inputSchema);
  });

  it("returns results as JSON text, and tool failures as isError", async () => {
    const replies = await exchange(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "poetics_search", arguments: { query: "price" } } },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "poetics_search", arguments: { query: "fail" } } },
    );
    const content = (reply: Record<string, unknown>) => (reply["result"] as { content: Array<{ text: string }>; isError?: boolean });
    expect(JSON.parse(content(replies[0]!).content[0]!.text)).toEqual({ units: [], query: "price" });
    expect(content(replies[1]!)).toEqual({ content: [{ type: "text", text: "query failed" }], isError: true });
  });

  it("answers protocol mistakes with JSON-RPC errors", async () => {
    const replies = await exchange(
      "{not json",
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "poetics_unit" } },
      { jsonrpc: "2.0", id: 2, method: "resources/list" },
    );
    expect(replies).toEqual([
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      { jsonrpc: "2.0", id: 1, error: { code: -32602, message: "Unknown tool: poetics_unit" } },
      { jsonrpc: "2.0", id: 2, error: { code: -32601, message: "Method not found: resources/list" } },
    ]);
  });
});
