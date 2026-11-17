import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Unit } from "@poetics/core";
import { filesInScope } from "@poetics/store";
import type { AdapterEntry, CommandAdapterConfig, PoeticsConfig } from "@poetics/store";
import { adaptersFor, indexReport, readTextsWith } from "./adapters.ts";
import { AdapterError, commandAdapter, linesOf, spanOfLines } from "./command-adapter.ts";
import { applyIndex, planIndex } from "./indexing.ts";
import { run } from "./run.ts";
import { runGit, write } from "./test-helpers.ts";

const FAKE = join(import.meta.dirname, "fake-adapter.mjs");
const FIXTURE = join(import.meta.dirname, "../../../schemas/fixtures/adapter/swift-basic");
const swift = (mode: string, extra: Partial<CommandAdapterConfig> = {}): CommandAdapterConfig => ({ name: "swift", command: [process.execPath, FAKE, mode], include: ["**/*.swift"], ...extra });
const human = { kind: "human" } as const;

const CANVAS = "import Foundation\n\nfunc draw() {\n  clamp()\n}\n\nfunc clamp() {\n  return\n}\n";

async function repo(files: Record<string, string>, adapters: readonly AdapterEntry[]): Promise<{ root: string; config: PoeticsConfig }> {
  const root = await mkdtemp(join(tmpdir(), "poetics-command-adapter-"));
  const config: PoeticsConfig = { include: ["Sources/**", "src/**"], adapters };
  for (const [path, text] of Object.entries(files)) await write(root, path, text);
  await write(root, ".poetics/config.json", JSON.stringify({ version: 1, ...config }));
  runGit(root, "init", "-q", "-b", "main");
  return { root, config };
}

async function units(root: string): Promise<Unit[]> {
  const dir = join(root, ".poetics/units");
  const files = await readdir(dir).catch(() => []);
  return Promise.all(files.map(async (file) => JSON.parse(await readFile(join(dir, file), "utf8")) as Unit));
}

describe("spanOfLines", () => {
  const text = "one\ntwo\nthree";
  const lines = linesOf(text);
  it("covers whole lines, without the last line's newline", () => {
    expect(spanOfLines("f", lines, 2, 2)).toEqual({ file: "f", start: 4, end: 7 });
    expect(text.slice(4, 7)).toBe("two");
    expect(spanOfLines("f", lines, 1, 3)).toEqual({ file: "f", start: 0, end: text.length });
  });

  it("clamps lines past the end of the text to it", () => {
    expect(spanOfLines("f", lines, 3, 9)).toEqual({ file: "f", start: 8, end: text.length });
    expect(spanOfLines("f", lines, 7, 9)).toEqual({ file: "f", start: text.length, end: text.length });
  });
});

describe("routing files to adapters", () => {
  it("puts a command adapter's files in scope, gives them to it alone, and lets the first listed win", async () => {
    const { root, config } = await repo({ "Sources/A.swift": CANVAS, "src/a.ts": "export const a = 1;\n", "Sources/B.kt": "" }, [
      "typescript",
      swift("echo"),
      { name: "also-swift", command: ["true"], include: ["Sources/**"] },
    ]);
    expect((await filesInScope(root, config)).parseable).toEqual(["Sources/A.swift", "Sources/B.kt", "src/a.ts"]);
    const [first, second, ts] = adaptersFor(root, config);
    expect(["Sources/A.swift", "Sources/B.kt", "src/a.ts"].map((file) => [first!.reads(file), second!.reads(file), ts!.reads(file)])).toEqual([
      [true, false, false],
      [false, true, false],
      [false, false, true],
    ]);
  });
});

describe("commandAdapter", () => {
  it("indexes files from disk, with spans from the lines it reports and edges resolved by name", async () => {
    const { root } = await repo({ "Sources/Canvas.swift": CANVAS }, [swift("echo")]);
    const { units: found, notRead } = commandAdapter(root, swift("echo")).index(["Sources/Canvas.swift"]);
    expect(notRead).toEqual([]);
    expect(found.map((unit) => [unit.key, unit.startLine, unit.endLine, CANVAS.slice(unit.span.start, unit.span.end)])).toEqual([
      ["Sources/Canvas.swift#draw()", 3, 5, "func draw() {\n  clamp()\n}"],
      ["Sources/Canvas.swift#clamp()", 7, 9, "func clamp() {\n  return\n}"],
    ]);
    expect(found[0]!.edges).toEqual([{ to: "Sources/Canvas.swift#clamp()", kind: "calls", resolution: "name" }]);
    expect(found[0]!.runtimeHash).toBeUndefined();
  });

  it("reads files from the text given, not from disk, without edges or interface hashes", async () => {
    const { root, config } = await repo({ "Sources/Canvas.swift": CANVAS }, [swift("echo")]);
    const read = readTextsWith(adaptersFor(root, config), [{ path: "Sources/Canvas.swift", text: "func old() {\n}\n" }]);
    expect(read.get("Sources/Canvas.swift")!.map((unit) => [unit.name, unit.signatureText])).toEqual([["old()", "func old()"]]);
    expect(read.get("Sources/Canvas.swift")![0]).not.toHaveProperty("edges");
    expect(read.get("Sources/Canvas.swift")![0]).not.toHaveProperty("interfaceHash");
  });

  it("reports a file the adapter could not read as not read, with no units", async () => {
    const { root, config } = await repo({ "Sources/A.swift": CANVAS, "Sources/B.swift": "// #unreadable\n" }, [swift("echo")]);
    const report = indexReport(adaptersFor(root, config), ["Sources/A.swift", "Sources/B.swift"]);
    expect(report.notRead).toEqual(["Sources/B.swift"]);
    expect(report.units.map((unit) => unit.name)).toEqual(["draw()", "clamp()"]);
  });

  it.each([
    ["exit", /swift: .* exited with 3\nswift-syntax: could not load the toolchain/],
    ["garbage", /wrote no valid JSON on stdout/],
    ["bad-shape", /breaks the adapter protocol: \/files\/0 must have exactly one of units and error/],
    ["unrequested", /does not match the request: elsewhere.swift: not requested/],
    ["wrong-name", /the response names adapter kotlin, not swift/],
  ])("refuses an adapter that fails or answers badly (%s)", async (mode, message) => {
    const { root } = await repo({ "Sources/A.swift": CANVAS }, [swift(mode)]);
    const adapter = commandAdapter(root, swift(mode));
    expect(() => adapter.index(["Sources/A.swift"])).toThrow(AdapterError);
    expect(() => adapter.index(["Sources/A.swift"])).toThrow(message);
  });

  it("stops an adapter that takes longer than its timeout, and one that cannot start", async () => {
    const { root } = await repo({ "Sources/A.swift": CANVAS }, []);
    expect(() => commandAdapter(root, swift("sleep", { timeoutSeconds: 0.5 })).index(["Sources/A.swift"])).toThrow("adapter swift: timed out after 0.5 s on 1 file(s)");
    expect(() => commandAdapter(root, { name: "swift", command: ["poetics-no-such-adapter"], include: ["**"] }).index(["Sources/A.swift"])).toThrow(
      "adapter swift: could not start poetics-no-such-adapter: is it installed and on PATH?",
    );
  });
});

describe("poetics index with a command adapter", () => {
  it("records units, then versions, and leaves units in a file the adapter could not read", async () => {
    const { root, config } = await repo({ "Sources/Canvas.swift": CANVAS, "Sources/Brush.swift": "func stroke() {\n}\n" }, [swift("echo")]);
    await applyIndex(root, await planIndex(root, config, { rationale: "Adopt Poetics" }), human);
    const first = await units(root);
    expect(first.map((unit) => [unit.name, unit.kind, unit.framework, unit.location.file]).sort()).toEqual([
      ["clamp()", "function", "none", "Sources/Canvas.swift"],
      ["draw()", "function", "none", "Sources/Canvas.swift"],
      ["stroke()", "function", "none", "Sources/Brush.swift"],
    ]);
    runGit(root, "add", "-A");
    runGit(root, "commit", "-q", "-m", "Adopt Poetics");

    await write(root, "Sources/Canvas.swift", CANVAS.replace("  return\n", "  return 1\n"));
    await write(root, "Sources/Brush.swift", "// #unreadable\nfunc stroke() {\n}\n");
    const plan = await planIndex(root, config, { rationale: "Clamp returns a value" });
    expect(plan.notRead).toEqual(["Sources/Brush.swift"]);
    expect(plan.removed).toEqual([]);
    // The fake adapter's interface hash is the signature line, which did not change.
    expect(plan.versions.map((v) => [v.key, v.version.change])).toEqual([["Sources/Canvas.swift#clamp()", "behaviour"]]);
  });

  it("fails the run, writing nothing, when the adapter fails", async () => {
    const { root } = await repo({ "Sources/Canvas.swift": CANVAS }, [swift("exit")]);
    const err: string[] = [];
    const code = await run(["index", "--write"], { out: () => {}, err: (text) => err.push(text) }, root);
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("adapter swift: ");
    expect(await units(root)).toEqual([]);
  });

  it("writes the units the swift-basic fixture expects from its response", async () => {
    const request = JSON.parse(await readFile(join(FIXTURE, "request.json"), "utf8")) as { files: Array<{ path: string; text?: string }> };
    // The fixture's files need only enough lines for the spans its response reports.
    const files = Object.fromEntries(request.files.map((file) => [file.path, file.text ?? "//\n".repeat(40)]));
    const { root, config } = await repo(files, [swift("replay", { command: [process.execPath, FAKE, "replay", join(FIXTURE, "response.json")] })]);
    const plan = await planIndex(root, config, { rationale: "Adopt Poetics" });
    expect(plan.notRead).toEqual(["Sources/Paint/Generated.swift"]);
    await applyIndex(root, plan, human);
    const written = await units(root);
    const keyOf = new Map(written.map((unit) => [unit.uid, `${unit.location.file}#${unit.name}`]));
    const summary = written
      .map((unit) => ({
        key: `${unit.location.file}#${unit.name}`,
        kind: unit.kind,
        framework: unit.framework,
        ...(unit.owner ? { owner: keyOf.get(unit.owner) } : {}),
        ...(unit.docs ? { docs: unit.docs } : {}),
        contentHash: unit.versions[0]!.contentHash,
        interfaceHash: unit.versions[0]!.interfaceHash,
        change: unit.versions[0]!.change,
      }))
      .sort((a, b) => (a.key < b.key ? -1 : 1));
    expect(summary).toEqual(JSON.parse(await readFile(join(FIXTURE, "units.json"), "utf8")));
  });
});
