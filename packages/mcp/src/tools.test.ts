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
  it("rejects unknown tools and stubs known ones", async () => {
    const server = createServer({ root: "." });
    await expect(server.callTool("nope", {})).rejects.toThrow("Unknown tool: nope");
    await expect(server.callTool("poetics_unit", { unit: "x" })).rejects.toThrow(NotImplementedError);
    await expect(server.listen()).rejects.toThrow(NotImplementedError);
  });
});
