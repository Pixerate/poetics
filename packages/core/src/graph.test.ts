import { describe, expect, it } from "vitest";
import { NotImplementedError } from "./errors.ts";
import { computeClosureHashes, createGraph, impactOf, stronglyConnectedComponents } from "./graph.ts";
import type { CompositionGraph } from "./graph.ts";

describe("composition graph", () => {
  it("is a typed stub until phase 1", () => {
    const graph = {} as CompositionGraph;
    expect(() => createGraph([])).toThrow(NotImplementedError);
    expect(() => stronglyConnectedComponents(graph)).toThrow(NotImplementedError);
    expect(() => computeClosureHashes(graph, new Map())).toThrow(NotImplementedError);
    expect(() => impactOf(graph, [])).toThrow(NotImplementedError);
  });
});
