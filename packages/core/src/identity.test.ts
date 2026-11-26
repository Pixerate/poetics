import { describe, expect, it } from "vitest";
import { contentHash } from "./hash.ts";
import { matchIdentities, similarity, trackedUnits } from "./identity.ts";
import type { CodeUnit, LineageDeclaration, TrackedUnit } from "./identity.ts";
import type { Unit, UnitKind } from "./types.ts";

/** A code unit at `file#name`; `body` stands in for its content, `shape` for its subtrees. */
function code(ref: string, body: string, shape: string[] = [body], kind: UnitKind = "function"): CodeUnit {
  const [file, name] = ref.split("#") as [string, string];
  return { key: ref, file, name, kind, contentHash: contentHash(body), fingerprint: shape };
}

const tracked = (uid: string, unit: CodeUnit): TrackedUnit => ({ ...unit, uid });

// Ten subtrees, and variants sharing all but one or all but five of them.
const SHAPE = Array.from({ length: 10 }, (_, i) => `s${i}`);
const EDITED = [...SHAPE.slice(1), "x0"];
const UNRELATED = ["u1", "u2", "u3"];

describe("similarity", () => {
  it("is the share of subtrees two fingerprints have in common", () => {
    expect(similarity(SHAPE, SHAPE)).toBe(1);
    expect(similarity(SHAPE, EDITED)).toBeCloseTo(9 / 11);
    expect(similarity(SHAPE, UNRELATED)).toBe(0);
    expect(similarity([], [])).toBe(1);
    expect(similarity(["a", "a", "b"], ["a", "b"])).toBe(1);
  });
});

describe("matchIdentities", () => {
  it("matches units that stayed put, even when edited, and reports new and removed ones", () => {
    const result = matchIdentities(
      [tracked("U1", code("a.ts#f", "f1", SHAPE)), tracked("U2", code("a.ts#gone", "g", UNRELATED))],
      [code("a.ts#f", "f2", ["changed"]), code("a.ts#fresh", "n", ["new"])],
    );
    expect(result.matched).toEqual([{ uid: "U1", key: "a.ts#f", via: "location", lineage: [] }]);
    expect(result.created).toEqual([{ key: "a.ts#fresh" }]);
    expect(result.removed).toEqual([{ uid: "U2" }]);
    expect(result.queued).toEqual([]);
  });

  it("follows unchanged content through a rename and a move, recording both", () => {
    const result = matchIdentities([tracked("U1", code("a.ts#f", "body"))], [code("b.ts#g", "body")]);
    expect(result.matched).toEqual([
      {
        uid: "U1",
        key: "b.ts#g",
        via: "content",
        lineage: [
          { kind: "move", from: "a.ts" },
          { kind: "rename", from: "f" },
        ],
      },
    ]);
    expect(result.created).toEqual([]);
    expect(result.removed).toEqual([]);
  });

  it("follows a unit edited as it moved by similarity, with the score", () => {
    const result = matchIdentities([tracked("U1", code("a.ts#f", "f1", SHAPE))], [code("b.ts#f", "f2", EDITED)]);
    expect(result.matched).toEqual([{ uid: "U1", key: "b.ts#f", via: "similarity", score: 0.818, lineage: [{ kind: "move", from: "a.ts" }] }]);
  });

  it("does not match below the threshold", () => {
    const half = [...SHAPE.slice(0, 5), "y0", "y1", "y2", "y3", "y4"];
    const result = matchIdentities([tracked("U1", code("a.ts#f", "f1", SHAPE))], [code("b.ts#g", "g", half)]);
    expect(result.matched).toEqual([]);
    expect(result.created).toEqual([{ key: "b.ts#g" }]);
    expect(result.removed).toEqual([{ uid: "U1" }]);
    expect(matchIdentities([tracked("U1", code("a.ts#f", "f1", SHAPE))], [code("b.ts#g", "g", half)], [], { threshold: 0.3 }).matched).toHaveLength(1);
  });

  it("pairs units that share content by name when their file moves", () => {
    const moved = matchIdentities(
      [tracked("U1", code("a.ts#f", "same")), tracked("U2", code("a.ts#g", "same")), tracked("U3", code("a.ts#h", "same"))],
      [code("b.ts#f", "same"), code("b.ts#g", "same"), code("b.ts#k", "same")],
    );
    expect(moved.matched.map((m) => [m.uid, m.key, m.via])).toEqual([
      ["U1", "b.ts#f", "content"],
      ["U2", "b.ts#g", "content"],
      ["U3", "b.ts#k", "content"],
    ]);
    expect(moved.queued).toEqual([]);
    // A name twice on one side tells nothing.
    const twice = matchIdentities([tracked("U1", code("a.ts#f", "same")), tracked("U2", code("c.ts#f", "same"))], [code("b.ts#f", "same"), code("d.ts#f", "same")]);
    expect(twice.matched).toEqual([]);
    expect(twice.queued).toHaveLength(1);
  });

  it("pairs look-alikes edited as their file moved by name, when each pair is itself similar", () => {
    // Three copies of one pattern, each with its own edit; every one resembles all three after the move.
    const copy = (n: number) => [...SHAPE, `own${n}`];
    const edited = (n: number) => [...SHAPE.slice(1), `own${n}`, "x0"];
    const result = matchIdentities(
      [tracked("U1", code("a.ts#One", "1", copy(1))), tracked("U2", code("a.ts#Two", "2", copy(2))), tracked("U3", code("a.ts#Three", "3", copy(3)))],
      [code("b.ts#Three", "3e", edited(3)), code("b.ts#One", "1e", edited(1)), code("b.ts#Two", "2e", edited(2))],
    );
    expect(result.matched.map((m) => [m.uid, m.key, m.via])).toEqual([
      ["U1", "b.ts#One", "similarity"],
      ["U2", "b.ts#Two", "similarity"],
      ["U3", "b.ts#Three", "similarity"],
    ]);
    expect(result.queued).toEqual([]);
  });

  it("does not pair look-alikes by name when that pair is not similar enough", () => {
    const set = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);
    const [c, a, b] = [set("c", 6), set("a", 6), set("b", 6)];
    // f's new code looks like g's old code, not like f's: the names say one thing, the shapes another.
    const result = matchIdentities(
      [tracked("U1", code("a.ts#f", "f", [...c, ...a])), tracked("U2", code("a.ts#g", "g", [...c, ...b]))],
      [code("b.ts#f", "f2", [...c, ...b, "x"]), code("b.ts#g", "g2", [...c, ...a, ...b])],
    );
    expect(result.matched.map((m) => [m.uid, m.key])).toEqual([["U2", "b.ts#g"]]);
    expect(result.queued).toEqual([{ reason: "similar to more than one unit", uids: ["U1"], keys: ["b.ts#f"] }]);
  });

  it("queues rather than guesses when content or shape fits more than one unit", () => {
    const sameContent = matchIdentities(
      [tracked("U1", code("a.ts#f", "same")), tracked("U2", code("a.ts#g", "same"))],
      [code("b.ts#f2", "same"), code("b.ts#g2", "same")],
    );
    expect(sameContent.queued).toEqual([{ reason: "4 units share the same content", uids: ["U1", "U2"], keys: ["b.ts#f2", "b.ts#g2"] }]);
    expect([sameContent.matched, sameContent.created, sameContent.removed]).toEqual([[], [], []]);

    const twoLookAlikes = matchIdentities([tracked("U1", code("a.ts#f", "f", SHAPE))], [code("b.ts#x", "x", EDITED), code("b.ts#y", "y", [...SHAPE.slice(2), "z0", "z1"])]);
    expect(twoLookAlikes.queued).toEqual([{ reason: "similar to more than one unit", uids: ["U1"], keys: ["b.ts#x", "b.ts#y"] }]);
    expect(twoLookAlikes.created).toEqual([]);
  });

  describe("a lone pair in a file (ADR 0028)", () => {
    // Four subtrees, renamed and given one more statement: too small and too changed for the similarity stage.
    const SMALL = ["t0", "t1", "t2", "t3"];
    const GREW = ["t1", "t2", "t3", "n0", "n1", "n2"];

    it("pairs a file's one leftover tracked unit with its one new unit when they share some shape", () => {
      const result = matchIdentities([tracked("U1", code("a.ts#f", "f", SMALL)), tracked("U2", code("a.ts#g", "g", SHAPE))], [code("a.ts#fGate", "f2", GREW), code("a.ts#g", "g", SHAPE)]);
      expect(result.matched).toEqual([
        { uid: "U2", key: "a.ts#g", via: "location", lineage: [] },
        { uid: "U1", key: "a.ts#fGate", via: "lone", score: 0.429, lineage: [{ kind: "rename", from: "f" }] },
      ]);
      expect([result.created, result.removed, result.queued]).toEqual([[], [], []]);
    });

    it("does not pair units that share too little, and takes its threshold from the options", () => {
      const other = ["t0", "o1", "o2", "o3", "o4", "o5"];
      const before = [tracked("U1", code("a.ts#f", "f", SMALL))];
      const result = matchIdentities(before, [code("a.ts#other", "o", other)]);
      expect(result.matched).toEqual([]);
      expect(result.created).toEqual([{ key: "a.ts#other" }]);
      expect(result.removed).toEqual([{ uid: "U1" }]);
      expect(matchIdentities(before, [code("a.ts#other", "o", other)], [], { loneThreshold: 0.1 }).matched.map((m) => m.via)).toEqual(["lone"]);
      expect(matchIdentities(before, [code("a.ts#fGate", "f2", GREW)], [], { loneThreshold: 0.5 }).matched).toEqual([]);
    });

    it("needs exactly one unit open on each side, in the same file and namespace", () => {
      const two = matchIdentities([tracked("U1", code("a.ts#f", "f", SMALL))], [code("a.ts#fGate", "f2", GREW), code("a.ts#h", "h", ["t1", "t2", "h0"])]);
      expect(two.matched).toEqual([]);
      expect(two.created).toHaveLength(2);
      const twoBefore = matchIdentities([tracked("U1", code("a.ts#f", "f", SMALL)), tracked("U2", code("a.ts#h", "h", ["t1", "h0"]))], [code("a.ts#fGate", "f2", GREW)]);
      expect(twoBefore.matched).toEqual([]);
      expect(matchIdentities([tracked("U1", code("a.ts#f", "f", SMALL))], [code("b.ts#fGate", "f2", GREW)]).matched).toEqual([]);
      expect(matchIdentities([tracked("U1", code("a.ts#f", "f", SMALL))], [code("a.ts#F", "f2", GREW, "type")]).matched).toEqual([]);
    });

    it("counts a value and a type in one file apart, pairing each namespace's lone pair", () => {
      const result = matchIdentities(
        [tracked("U1", code("a.ts#f", "f", SMALL)), tracked("U2", code("a.ts#T", "t", ["k0", "k1"], "type"))],
        [code("a.ts#fGate", "f2", GREW), code("a.ts#TGate", "t2", ["k0", "k1", "k2"], "type")],
      );
      expect(result.matched.map((m) => [m.uid, m.key, m.via])).toEqual([
        ["U1", "a.ts#fGate", "lone"],
        ["U2", "a.ts#TGate", "lone"],
      ]);
    });

    it("pairs a lone pair that keeps its base name at any similarity, as a Swift function given a parameter (ADR 0030)", () => {
      const result = matchIdentities(
        [tracked("U1", code("a.swift#ExploreView.init()", "i", ["e0", "e1"]))],
        [code("a.swift#ExploreView.init(scrollToTopSignal:)", "i2", ["p0", "p1", "p2", "p3", "p4"])],
      );
      expect(result.matched).toEqual([
        { uid: "U1", key: "a.swift#ExploreView.init(scrollToTopSignal:)", via: "lone", score: 0, lineage: [{ kind: "rename", from: "ExploreView.init()" }] },
      ]);
      const labelsOnly = matchIdentities([tracked("U1", code("a.swift#playSound(of:)", "p", SMALL))], [code("a.swift#playSound(_:)", "p2", ["z0"])], [], { loneThreshold: 0.9 });
      expect(labelsOnly.matched.map((m) => m.via)).toEqual(["lone"]);
    });

    it("does not let a shared base name pair units that are not alone, or that changed their base name", () => {
      const twoNew = matchIdentities([tracked("U1", code("a.swift#init()", "i", ["e0"]))], [code("a.swift#init(a:)", "a", ["x0"]), code("a.swift#init(b:)", "b", ["y0"])]);
      expect(twoNew.matched).toEqual([]);
      const otherBase = matchIdentities([tracked("U1", code("a.swift#viewDidLoad()", "v", ["e0", "e1"]))], [code("a.swift#viewDidAppear()", "w", ["x0", "x1"])]);
      expect(otherBase.matched).toEqual([]);
      // Owners count: a member keeps its base name only under the same type.
      const otherOwner = matchIdentities([tracked("U1", code("a.swift#A.init()", "i", ["e0"]))], [code("a.swift#B.init(x:)", "j", ["x0"])]);
      expect(otherOwner.matched).toEqual([]);
    });

    it("leaves what an earlier stage queued for a person", () => {
      const result = matchIdentities([tracked("U1", code("a.ts#f", "same")), tracked("U2", code("a.ts#g", "same"))], [code("a.ts#f2", "same"), code("a.ts#g2", "same")]);
      expect(result.matched).toEqual([]);
      expect(result.queued).toHaveLength(1);
    });
  });

  describe("members following their owner (ADR 0027)", () => {
    const type = (ref: string, body: string) => code(ref, body, SHAPE, "type");
    const member = (ref: string, body: string, owner: string) => ({ ...code(ref, body, ["m"]), owner });
    const trackedMember = (uid: string, ref: string, body: string, ownerUid: string) => ({ ...tracked(uid, code(ref, body, ["m"])), ownerUid });

    it("keeps a member that names its renamed type, though its name and content both changed", () => {
      const result = matchIdentities(
        [tracked("T", type("a.swift#Encoding", "type")), trackedMember("M", "a.swift#Encoding.default", "Encoding()", "T")],
        [type("a.swift#EncodingGate", "type"), member("a.swift#EncodingGate.default", "EncodingGate()", "a.swift#EncodingGate")],
      );
      expect(result.matched.map((m) => [m.uid, m.key, m.via])).toEqual([
        ["T", "a.swift#EncodingGate", "content"],
        ["M", "a.swift#EncodingGate.default", "owner"],
      ]);
      expect(result.matched[1]!.lineage).toEqual([{ kind: "rename", from: "Encoding.default" }]);
      expect([result.created, result.removed, result.queued]).toEqual([[], [], []]);
    });

    it("pairs a renamed type's identical members by their names within it instead of queueing them", () => {
      const result = matchIdentities(
        [tracked("T", type("a.swift#Monitor", "type")), trackedMember("M1", "a.swift#Monitor.didStart()", "{}", "T"), trackedMember("M2", "a.swift#Monitor.didStop()", "{}", "T")],
        [type("a.swift#MonitorGate", "type"), member("a.swift#MonitorGate.didStop()", "{}", "a.swift#MonitorGate"), member("a.swift#MonitorGate.didStart()", "{}", "a.swift#MonitorGate")],
      );
      expect(result.matched.map((m) => [m.uid, m.key, m.via]).sort()).toEqual([
        ["M1", "a.swift#MonitorGate.didStart()", "owner"],
        ["M2", "a.swift#MonitorGate.didStop()", "owner"],
        ["T", "a.swift#MonitorGate", "content"],
      ]);
      expect(result.queued).toEqual([]);
    });

    it("brings a nested type's members along", () => {
      // The outer type keeps its content; the nested type and its member change with the rename.
      const result = matchIdentities(
        [tracked("T", type("a.swift#Outer", "outer")), { ...tracked("N", code("a.swift#Outer.Inner", "inner", ["i"], "type")), ownerUid: "T" }, trackedMember("M", "a.swift#Outer.Inner.run()", "run(Outer.Inner)", "N")],
        [type("b.swift#OuterGate", "outer"), { ...code("b.swift#OuterGate.Inner", "inner2", ["i"], "type"), owner: "b.swift#OuterGate" }, member("b.swift#OuterGate.Inner.run()", "run(OuterGate.Inner)", "b.swift#OuterGate.Inner")],
      );
      expect(result.matched.map((m) => [m.uid, m.via])).toEqual([
        ["T", "content"],
        ["N", "owner"],
        ["M", "owner"],
      ]);
      expect(result.created).toEqual([]);
    });

    it("matches members whose names do not include their owner's, as a component's script functions", () => {
      const component = (ref: string) => code(ref, "component", SHAPE, "component");
      const result = matchIdentities(
        [tracked("C", component("src/Card.svelte#Card")), trackedMember("H", "src/Card.svelte#handle", "a", "C")],
        [component("src/Tile.svelte#Tile"), member("src/Tile.svelte#handle", "b", "src/Tile.svelte#Tile")],
      );
      expect(result.matched.map((m) => [m.uid, m.key, m.via])).toEqual([
        ["C", "src/Tile.svelte#Tile", "content"],
        ["H", "src/Tile.svelte#handle", "owner"],
      ]);
    });

    it("does not pair a member renamed with its type, nor one under another owner", () => {
      const result = matchIdentities(
        [tracked("T", type("a.swift#Encoding", "type")), trackedMember("M", "a.swift#Encoding.default", "Encoding()", "T")],
        [type("a.swift#EncodingGate", "type"), member("a.swift#EncodingGate.standard", "EncodingGate()", "a.swift#EncodingGate"), member("a.swift#Other.default", "EncodingGate()", "a.swift#Other")],
      );
      expect(result.matched.map((m) => m.uid)).toEqual(["T"]);
      expect(result.removed).toEqual([{ uid: "M" }]);
    });

    it("still queues what is left ambiguous, with the count of what is left", () => {
      const result = matchIdentities(
        [tracked("T", type("a.swift#Monitor", "type")), trackedMember("M1", "a.swift#Monitor.didStart()", "{}", "T"), tracked("F", code("a.swift#f", "{}")), tracked("G", code("a.swift#g", "{}"))],
        [type("a.swift#MonitorGate", "type"), member("a.swift#MonitorGate.didStart()", "{}", "a.swift#MonitorGate"), code("b.swift#f2", "{}"), code("b.swift#g2", "{}")],
      );
      expect(result.matched.find((m) => m.uid === "M1")?.via).toBe("owner");
      expect(result.queued).toEqual([{ reason: "4 units share the same content", uids: ["F", "G"], keys: ["b.swift#f2", "b.swift#g2"] }]);
    });
  });

  it("never turns a function into a type", () => {
    const result = matchIdentities([tracked("U1", code("a.ts#P", "body"))], [code("b.ts#P", "body", ["body"], "type")]);
    expect(result.matched).toEqual([]);
  });

  it("treats a hook renamed to a plain function as the same value", () => {
    const result = matchIdentities([tracked("U1", code("a.ts#useF", "body", ["body"], "hook"))], [code("a.ts#f", "body")]);
    expect(result.matched).toMatchObject([{ uid: "U1", via: "content" }]);
  });

  describe("declared lineage", () => {
    const ref = (file: string, name: string, kind: UnitKind = "function") => ({ file, name, kind });

    it("comes first, over a location or content match", () => {
      // Without the declaration, U1 would keep a.ts#f by location and U2 would follow its content.
      const before = [tracked("U1", code("a.ts#f", "old")), tracked("U2", code("a.ts#g", "body"))];
      const after = [code("a.ts#f", "body"), code("a.ts#h", "other")];
      const result = matchIdentities(before, after, [
        { kind: "rename", uids: ["U1"], to: [ref("a.ts", "h")] },
        { kind: "rename", uids: ["U2"], to: [ref("a.ts", "f")] },
      ]);
      expect(result.matched).toEqual([
        { uid: "U1", key: "a.ts#h", via: "declared", lineage: [{ kind: "rename", from: "f" }] },
        { uid: "U2", key: "a.ts#f", via: "declared", lineage: [{ kind: "rename", from: "g" }] },
      ]);
    });

    it("applies a split: the first part keeps the uid, the others are created with lineage", () => {
      const result = matchIdentities(
        [tracked("U1", code("a.ts#f", "whole", SHAPE))],
        [code("a.ts#f", "half"), code("b.ts#fHelper", "rest")],
        [{ kind: "split", uids: ["U1"], to: [ref("a.ts", "f"), ref("b.ts", "fHelper")] }],
      );
      expect(result.matched).toEqual([{ uid: "U1", key: "a.ts#f", via: "declared", lineage: [], splitInto: ["b.ts#fHelper"] }]);
      expect(result.created).toEqual([{ key: "b.ts#fHelper", lineage: [{ kind: "split", uids: ["U1"] }] }]);
    });

    it("applies a merge: the first uid survives and the others are removed into it", () => {
      const result = matchIdentities(
        [tracked("U1", code("a.ts#f", "f")), tracked("U2", code("a.ts#g", "g"))],
        [code("a.ts#f", "fg")],
        [{ kind: "merge", uids: ["U1", "U2"], to: [ref("a.ts", "f")] }],
      );
      expect(result.matched).toEqual([{ uid: "U1", key: "a.ts#f", via: "declared", lineage: [{ kind: "merge", uids: ["U2"] }] }]);
      expect(result.removed).toEqual([{ uid: "U2", mergedInto: "U1" }]);
    });

    it("rejects declarations the snapshots disagree with, and matches as if they were not made", () => {
      const before = [tracked("U1", code("a.ts#f", "f")), tracked("U2", code("a.ts#g", "g"))];
      const after = [code("a.ts#f", "f"), code("a.ts#g", "g"), code("b.ts#f", "moved")];
      const cases: Array<[LineageDeclaration, string]> = [
        [{ kind: "rename", uids: ["U9"], to: [ref("a.ts", "f")] }, "U9 is not a tracked unit in the earlier snapshot"],
        [{ kind: "move", uids: ["U1"], to: [ref("c.ts", "f")] }, "there is no function f in c.ts"],
        [{ kind: "move", uids: ["U1"], to: [ref("b.ts", "f")] }, "f is still in a.ts, so it was not moved or renamed"],
        [{ kind: "rename", uids: ["U1"], to: [ref("a.ts", "f")] }, "f kept its name, so it was not renamed"],
        [{ kind: "move", uids: ["U1", "U2"], to: [ref("b.ts", "f")] }, "a move names one uid and one target"],
        [{ kind: "split", uids: ["U1"], to: [ref("b.ts", "f")] }, "a split names one uid and at least two parts"],
        [{ kind: "merge", uids: ["U1", "U2"], to: [ref("a.ts", "f")] }, "g is still in a.ts, so it was not merged"],
        [{ kind: "rename", uids: ["U1"], to: [ref("a.ts", "f", "type")] }, "there is no type f in a.ts"],
      ];
      for (const [declaration, reason] of cases) {
        const result = matchIdentities(before, after, [declaration]);
        expect(result.rejected).toEqual([{ declaration, reason }]);
        expect(result.matched.map((m) => [m.uid, m.via])).toEqual([
          ["U1", "location"],
          ["U2", "location"],
        ]);
      }
    });

    it("rejects a second claim on a uid or a target", () => {
      const before = [tracked("U1", code("a.ts#f", "f")), tracked("U2", code("a.ts#g", "g"))];
      const after = [code("b.ts#f", "f"), code("b.ts#h", "h")];
      const result = matchIdentities(before, after, [
        { kind: "move", uids: ["U1"], to: [ref("b.ts", "f")] },
        { kind: "move", uids: ["U1"], to: [ref("b.ts", "h")] },
        { kind: "move", uids: ["U2"], to: [ref("b.ts", "f")] },
      ]);
      expect(result.rejected.map((r) => r.reason)).toEqual([
        "U1 is already matched by an earlier declaration",
        "b.ts#f is already claimed by an earlier declaration",
      ]);
    });
  });
});

describe("trackedUnits", () => {
  const unit = (uid: string, file: string, name: string, kind: UnitKind, removed = false): Unit => ({
    uid,
    kind,
    framework: "none",
    name,
    location: { file },
    versions: [
      { contentHash: "git:0000000000000000000000000000000000000001", change: "created", actor: { kind: "human" }, rationale: "Seed" },
      ...(removed ? [{ contentHash: "git:e69de29bb2d1d6434b8b29ae775ad8c2e48c5391" as const, change: "removed" as const, actor: { kind: "human" as const }, rationale: "Gone" }] : []),
    ],
  });

  it("pairs live store units with the code at their recorded place, by namespace", () => {
    const codeUnits = [code("a.ts#f", "f"), code("a.ts#Io", "io", ["io"], "type"), code("a.ts#Io:fn", "iofn")];
    codeUnits[2] = { ...codeUnits[2]!, name: "Io" };
    const { tracked: found, missing } = trackedUnits(
      [unit("U1", "a.ts", "f", "function"), unit("U2", "a.ts", "Io", "type"), unit("U3", "a.ts", "gone", "function"), unit("U4", "a.ts", "old", "function", true)],
      codeUnits,
    );
    expect(found.map((t) => [t.uid, t.key])).toEqual([
      ["U1", "a.ts#f"],
      ["U2", "a.ts#Io"],
    ]);
    expect(missing).toEqual(["U3"]);
  });
});
