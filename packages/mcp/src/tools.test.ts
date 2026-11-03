import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { NotImplementedError } from "@poetics/core";
import { createServer } from "./server.ts";
import { DATA_NOT_INSTRUCTIONS, TOOLS, findTool } from "./tools.ts";

describe("TOOLS", () => {
  it("covers the plan's tool table", () => {
    expect(TOOLS.map((tool) => tool.name).sort()).toEqual(
      [
        "poetics_changes",
        "poetics_context_pack",
        "poetics_declare_lineage",
        "poetics_history",
        "poetics_impact",
        "poetics_link_test",
        "poetics_notes",
        "poetics_record_note",
        "poetics_record_rationale",
        "poetics_search",
        "poetics_set_docs",
        "poetics_signals",
        "poetics_tests_for",
        "poetics_unit",
        "poetics_verify",
      ].sort(),
    );
  });

  it("marks exactly the append-only operations as writes", () => {
    expect(TOOLS.filter((tool) => tool.access === "write").map((tool) => tool.name)).toEqual([
      "poetics_record_rationale",
      "poetics_declare_lineage",
      "poetics_link_test",
      "poetics_set_docs",
      "poetics_record_note",
    ]);
  });

  it("tells agents in every description that results are data", () => {
    for (const tool of TOOLS) expect(tool.description).toContain(DATA_NOT_INSTRUCTIONS);
  });

  it("only lists required properties that exist", () => {
    for (const tool of TOOLS) {
      for (const key of tool.inputSchema.required ?? []) expect(tool.inputSchema.properties).toHaveProperty(key);
    }
  });

  it("looks tools up by name", () => {
    expect(findTool("poetics_unit")?.access).toBe("read");
    expect(findTool("nope")).toBeUndefined();
  });
});

describe("createServer", () => {
  it("rejects unknown tools and stubs the ones it cannot answer yet", async () => {
    const server = createServer({ root: "." });
    await expect(server.callTool("nope", {})).rejects.toThrow("Unknown tool: nope");
    await expect(server.callTool("poetics_impact", {})).rejects.toThrow(NotImplementedError);
    await expect(server.callTool("poetics_record_rationale", { unit: "x", rationale: "why" })).rejects.toThrow(NotImplementedError);
  });

  it("advertises only the tools it answers", () => {
    expect(
      createServer({ root: "." })
        .tools()
        .map((tool) => tool.name),
    ).toEqual(["poetics_context_pack", "poetics_search", "poetics_unit", "poetics_history", "poetics_changes", "poetics_tests_for", "poetics_notes"]);
  });

  it("answers read tools from this repository's own store over stdio", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let text = "";
    output.on("data", (chunk: Buffer) => (text += chunk.toString()));
    const done = createServer({ root: process.cwd() }).listen({ input, output });
    input.end(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "poetics_unit", arguments: { unit: "searchUnits" } } })}\n`);
    await done;
    const reply = JSON.parse(text) as { result: { content: Array<{ text: string }>; isError?: boolean } };
    expect(reply.result.isError).toBeUndefined();
    expect(JSON.parse(reply.result.content[0]!.text)).toMatchObject({ name: "searchUnits", location: { file: "packages/store/src/index-db.ts" } });
  });

  it("answers poetics_changes from the repository's git history", async () => {
    const server = createServer({ root: process.cwd() });
    // An empty range: the store's own tests cover what a non-empty one returns.
    await expect(server.callTool("poetics_changes", { from: "HEAD", to: "HEAD" })).resolves.toMatchObject({
      commits: [],
      unrecorded: [],
      decisions: [],
      notes: [],
    });
    await expect(server.callTool("poetics_changes", { impact: true })).rejects.toThrow(NotImplementedError);
    await expect(server.callTool("poetics_changes", { from: "nope", to: "HEAD" })).rejects.toThrow("Unknown git ref: nope");
  });
});
