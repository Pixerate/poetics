import { describe, expect, it } from "vitest";
import { computeClosureHashes, createGraph, impactOf, stronglyConnectedComponents } from "./graph.ts";
import { closureHash, contentHash } from "./hash.ts";
import type { Edge, EdgeKind, Hash, UnresolvedEdge } from "./types.ts";

const e = (from: string, to: string, kind: EdgeKind = "calls"): Edge => ({ from, to, kind });
const contents = (...uids: string[]) => new Map<string, Hash>(uids.map((uid) => [uid, contentHash({ uid })]));

describe("createGraph", () => {
  it("collects units from both ends of every edge and from unresolved edges", () => {
    const unresolved: UnresolvedEdge[] = [{ from: "D", kind: "renders", span: { file: "d.tsx", start: 0, end: 4 }, reason: "dynamic" }];
    const graph = createGraph([e("A", "B"), e("B", "C")], unresolved);
    expect([...graph.units].sort()).toEqual(["A", "B", "C", "D"]);
    expect(graph.unresolved).toEqual(unresolved);
  });

  it("answers dependencies and dependents, sorted and without duplicates", () => {
    const graph = createGraph([e("A", "C"), e("A", "B"), e("A", "B", "references-type"), e("D", "B")]);
    expect(graph.dependenciesOf("A")).toEqual(["B", "C"]);
    expect(graph.dependentsOf("B")).toEqual(["A", "D"]);
    expect(graph.dependenciesOf("B")).toEqual([]);
    expect(graph.dependentsOf("unknown")).toEqual([]);
  });

  it("copies its inputs", () => {
    const edges = [e("A", "B")];
    const graph = createGraph(edges);
    edges.push(e("B", "C"));
    expect(graph.edges).toHaveLength(1);
  });
});

describe("stronglyConnectedComponents", () => {
  it("returns singletons for an acyclic graph, dependencies first", () => {
    const sccs = stronglyConnectedComponents(createGraph([e("A", "B"), e("B", "C"), e("A", "C")]));
    expect(sccs).toEqual([["C"], ["B"], ["A"]]);
  });

  it("collapses cycles, including self-loops", () => {
    const sccs = stronglyConnectedComponents(createGraph([e("A", "B"), e("B", "C"), e("C", "B"), e("C", "D"), e("E", "E")]));
    expect(sccs).toContainEqual(["B", "C"]);
    expect(sccs).toContainEqual(["E"]);
    const at = (uid: string) => sccs.findIndex((c) => c.includes(uid));
    expect(at("D")).toBeLessThan(at("B"));
    expect(at("B")).toBeLessThan(at("A"));
    expect(sccs.flat().sort()).toEqual(["A", "B", "C", "D", "E"]);
  });

  it("handles chains far deeper than the call stack", () => {
    const edges = Array.from({ length: 50_000 }, (_, i) => e(`u${i}`, `u${i + 1}`));
    expect(stronglyConnectedComponents(createGraph(edges))).toHaveLength(50_001);
  });

  it("is empty for an empty graph", () => {
    expect(stronglyConnectedComponents(createGraph([]))).toEqual([]);
  });
});

describe("computeClosureHashes", () => {
  it("follows the Merkle formula for acyclic graphs", () => {
    const content = contents("A", "B", "C");
    const closures = computeClosureHashes(createGraph([e("A", "B"), e("A", "C"), e("B", "C")]), content);
    const c = closureHash(content.get("C")!, []);
    const b = closureHash(content.get("B")!, [c]);
    expect(closures.get("C")).toBe(c);
    expect(closures.get("B")).toBe(b);
    expect(closures.get("A")).toBe(closureHash(content.get("A")!, [b, c]));
  });

  it("changes a unit's closure when anything below it changes, and nothing above or beside", () => {
    const edges = [e("Page", "PriceTag"), e("PriceTag", "formatPrice"), e("Page", "Header")];
    const before = computeClosureHashes(createGraph(edges), contents("Page", "PriceTag", "formatPrice", "Header"));
    const changed = contents("Page", "PriceTag", "formatPrice", "Header");
    changed.set("formatPrice", contentHash({ uid: "formatPrice", v: 2 }));
    const after = computeClosureHashes(createGraph(edges), changed);
    for (const uid of ["formatPrice", "PriceTag", "Page"]) expect(after.get(uid)).not.toBe(before.get(uid));
    expect(after.get("Header")).toBe(before.get("Header"));
  });

  it("treats npm packages as leaves keyed by package@version", () => {
    const content = contents("Button");
    content.set("npm:react", contentHash("react@18.3.1"));
    const graph = createGraph([e("Button", "npm:react")]);
    const before = computeClosureHashes(graph, content).get("Button");
    content.set("npm:react", contentHash("react@19.0.0"));
    expect(computeClosureHashes(graph, content).get("Button")).not.toBe(before);
  });

  it("hashes a cycle together: a change to one member changes every member", () => {
    const edges = [e("Tree", "Node"), e("Node", "Tree"), e("Node", "Leaf"), e("App", "Tree")];
    const content = contents("Tree", "Node", "Leaf", "App");
    const before = computeClosureHashes(createGraph(edges), content);
    expect(before.get("Tree")).not.toBe(before.get("Node"));
    content.set("Tree", contentHash({ uid: "Tree", v: 2 }));
    const after = computeClosureHashes(createGraph(edges), content);
    for (const uid of ["Tree", "Node", "App"]) expect(after.get(uid)).not.toBe(before.get(uid));
    expect(after.get("Leaf")).toBe(before.get("Leaf"));
  });

  it("propagates a change below a cycle to every member", () => {
    const edges = [e("A", "B"), e("B", "A"), e("B", "C")];
    const content = contents("A", "B", "C");
    const before = computeClosureHashes(createGraph(edges), content);
    content.set("C", contentHash({ uid: "C", v: 2 }));
    const after = computeClosureHashes(createGraph(edges), content);
    expect(after.get("A")).not.toBe(before.get("A"));
    expect(after.get("B")).not.toBe(before.get("B"));
  });

  it("gives a self-recursive unit a closure distinct from a plain leaf", () => {
    const content = contents("fib");
    const recursive = computeClosureHashes(createGraph([e("fib", "fib")]), content).get("fib");
    expect(recursive).not.toBe(closureHash(content.get("fib")!, []));
  });

  it("hashes units with no edges as leaves", () => {
    const content = contents("lonely");
    expect(computeClosureHashes(createGraph([]), content).get("lonely")).toBe(closureHash(content.get("lonely")!, []));
  });

  it("throws when a unit in the graph has no content hash", () => {
    expect(() => computeClosureHashes(createGraph([e("A", "B")]), contents("A"))).toThrow(/no content hash for unit B/);
  });
});

describe("impactOf", () => {
  const graph = createGraph([e("Page", "Cart"), e("Cart", "PriceTag"), e("PriceTag", "formatPrice"), e("Checkout", "formatPrice"), e("Page", "Header")]);

  it("ranks the changed unit and its transitive dependents by distance", () => {
    expect(impactOf(graph, ["formatPrice"])).toEqual([
      { uid: "formatPrice", distance: 0, reason: "own" },
      { uid: "Checkout", distance: 1, reason: "closure" },
      { uid: "PriceTag", distance: 1, reason: "closure" },
      { uid: "Cart", distance: 2, reason: "closure" },
      { uid: "Page", distance: 3, reason: "closure" },
    ]);
  });

  it("flags direct callers of an interface change, and only those", () => {
    const impact = impactOf(graph, [], { interfaceChanged: ["formatPrice"] });
    expect(impact.find((i) => i.uid === "formatPrice")?.reason).toBe("own");
    expect(impact.find((i) => i.uid === "PriceTag")?.reason).toBe("interface-caller");
    expect(impact.find((i) => i.uid === "Checkout")?.reason).toBe("interface-caller");
    expect(impact.find((i) => i.uid === "Cart")?.reason).toBe("closure");
  });

  it("measures distance from the nearest changed unit", () => {
    const impact = impactOf(graph, ["formatPrice", "Cart"]);
    expect(impact.find((i) => i.uid === "Page")?.distance).toBe(1);
    expect(impact.find((i) => i.uid === "Cart")?.reason).toBe("own");
  });

  it("terminates on cycles", () => {
    const cyclic = createGraph([e("A", "B"), e("B", "A"), e("C", "A")]);
    expect(impactOf(cyclic, ["A"]).map((i) => i.uid)).toEqual(["A", "B", "C"]);
  });

  it("reports changed units the graph does not know about", () => {
    expect(impactOf(graph, ["new"])).toEqual([{ uid: "new", distance: 0, reason: "own" }]);
  });
});
