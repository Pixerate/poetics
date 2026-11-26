import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { baseName, formatScan, lonePairs, scanHistory } from "./lone-scan.ts";
import type { ScanResult, ScanUnit } from "./lone-scan.ts";

/** A unit at `file#name` with `shape` for its fingerprint. */
const unit = (ref: string, shape: string[], owner?: string): ScanUnit => {
  const [file, name] = ref.split("#") as [string, string];
  return { key: ref, name, kind: "function", contentHash: `b3:${ref}${shape.join()}`, fingerprint: shape, span: { file }, ...(owner ? { owner } : {}) };
};

describe("baseName", () => {
  it("is the name before any argument labels, owner included", () => {
    expect(baseName("ExploreView.init(scrollToTopSignal:)")).toBe("ExploreView.init");
    expect(baseName("playSound(_:)")).toBe("playSound");
    expect(baseName("formatPrice")).toBe("formatPrice");
  });
});

describe("lonePairs", () => {
  it("lists a file's one leftover pair whatever its score, saying whether it keeps its base name", () => {
    const pairs = lonePairs(
      [unit("a.swift#init()", ["e0"]), unit("a.swift#f()", ["s0", "s1"]), unit("b.swift#g()", ["s2", "s3"])],
      [unit("a.swift#init(x:)", ["p0"]), unit("a.swift#f()", ["s0", "s1"]), unit("b.swift#h()", ["s2", "z0"])],
    );
    expect(pairs).toEqual([
      { file: "a.swift", from: "init()", to: "init(x:)", score: 0, keepsBaseName: true, sizes: [1, 1] },
      { file: "b.swift", from: "g()", to: "h()", score: 0.333, keepsBaseName: false, sizes: [2, 2] },
    ]);
  });

  it("leaves out what earlier stages match and files with more than one unit left on a side", () => {
    const pairs = lonePairs(
      [unit("a.ts#moved", ["m0", "m1"]), unit("c.ts#x", ["x0"])],
      [unit("b.ts#moved", ["m0", "m1"]), unit("c.ts#y", ["y0"]), unit("c.ts#z", ["z0"])],
    );
    expect(pairs).toEqual([]);
  });

  it("lets members follow a renamed owner first, as indexing does", () => {
    const pairs = lonePairs(
      [{ ...unit("a.swift#T", ["t0", "t1"]), kind: "type", contentHash: "b3:type" }, unit("a.swift#T.f()", ["f0"], "a.swift#T")],
      [{ ...unit("a.swift#U", ["t0", "t1"]), kind: "type", contentHash: "b3:type" }, unit("a.swift#U.f()", ["g0"], "a.swift#U")],
    );
    expect(pairs).toEqual([]);
  });
});

describe("scanHistory", () => {
  const git = (root: string, ...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
  const commit = async (root: string, files: Record<string, string>, message: string) => {
    for (const [file, text] of Object.entries(files)) {
      await mkdir(dirname(join(root, file)), { recursive: true });
      await writeFile(join(root, file), text);
    }
    git(root, "add", "-A");
    git(root, "-c", "user.name=Scan", "-c", "user.email=scan@example.test", "commit", "-q", "--no-gpg-sign", "-m", message);
  };

  it("finds a renamed and edited function in a real commit, and skips commits that touch no unit's place", async () => {
    const root = await mkdtemp(join(tmpdir(), "poetics-lone-scan-"));
    git(root, "init", "-q", "-b", "main");
    await commit(root, { "src/a.ts": "export function total(n: number) {\n  return n;\n}\n", "README.md": "one\n" }, "Seed");
    await commit(root, { "src/a.ts": "export function sum(n: number) {\n  const m = n * 2;\n  return m;\n}\n" }, "Rename total to sum");
    await commit(root, { "README.md": "two\n" }, "Docs only");
    const result = await scanHistory(root, { name: "tiny", repo: "example/tiny", include: ["src/**/*.ts"], exclude: [] }, { head: "HEAD", commits: 10, work: join(root, "..", `${root.split("/").at(-1)}-work`) });
    expect(result).toMatchObject({ name: "tiny", commits: 3, skipped: 0 });
    expect(result.pairs).toEqual([
      { commit: expect.stringMatching(/^[0-9a-f]{9}$/), subject: "Rename total to sum", file: "src/a.ts", from: "total", to: "sum", score: expect.any(Number), keepsBaseName: false, sizes: [expect.any(Number), expect.any(Number)] },
    ]);
  });

  it("counts a commit touching more files than the limit as skipped", async () => {
    const root = await mkdtemp(join(tmpdir(), "poetics-lone-scan-"));
    git(root, "init", "-q", "-b", "main");
    await commit(root, { "src/a.ts": "export const a = 1;\n", "src/b.ts": "export const b = 1;\n" }, "Seed");
    await commit(root, { "src/a.ts": "export const a = 2;\n", "src/b.ts": "export const b = 2;\n" }, "Both");
    const result = await scanHistory(root, { name: "tiny", repo: "example/tiny", include: ["src/**/*.ts"], exclude: [] }, { head: "HEAD", commits: 10, work: `${root}-work`, maxFiles: 1 });
    expect(result).toMatchObject({ commits: 2, skipped: 1, pairs: [] });
  });
});

describe("formatScan", () => {
  it("counts pairs by how stage 6 decides them and lists each for a person to judge", () => {
    const result: ScanResult = {
      name: "tiny",
      repo: "example/tiny",
      head: "abcdef1234",
      commits: 3,
      skipped: 1,
      pairs: [
        { commit: "111111111", subject: "Add a parameter", file: "a.swift", from: "init()", to: "init(x:)", score: 0, keepsBaseName: true, sizes: [2, 5] },
        { commit: "222222222", subject: "Rename | rework", file: "a.swift", from: "f()", to: "g()", score: 0.45, keepsBaseName: false, sizes: [9, 9] },
        { commit: "333333333", subject: "Replace", file: "b.swift", from: "h()", to: "k()", score: 0.05, keepsBaseName: false, sizes: [4, 4] },
      ],
    };
    const text = formatScan([result], { date: "2026-11-26" });
    expect(text).toContain("| tiny | 3 | 1 | 3 | 1 | 1 | 1 |");
    expect(text).toContain("### Matched below 0.2 because they keep their base name (1)");
    expect(text).toContain("| 0.450 | 9, 9 | [`2222222`](https://github.com/example/tiny/commit/222222222) | `f()` | `g()` | Rename \\| rework |");
    expect(text).toContain("### Not matched (1)");
  });
});
