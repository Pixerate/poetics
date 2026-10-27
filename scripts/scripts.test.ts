import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isUid } from "@poetics/core";
import { mintUids } from "./mint-uid.ts";
import { provisionalHash } from "./provisional-hash.ts";
import { reindex } from "./reindex.ts";
import { main } from "./validate.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const UID = "01JB8K0000000000000000000A";

async function repoWith(unit: object): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "poetics-scripts-"));
  await mkdir(join(root, ".poetics", "units"), { recursive: true });
  await writeFile(join(root, "a.ts"), "export {};\n");
  await writeFile(
    join(root, ".poetics", "config.json"),
    JSON.stringify({ version: 1, adapters: ["typescript"], include: ["**/*.ts"] }),
  );
  await writeFile(join(root, ".poetics", "units", `${UID}.json`), JSON.stringify(unit));
  return root;
}

const goodUnit = {
  uid: UID,
  kind: "function",
  framework: "none",
  name: "a",
  location: { file: "a.ts" },
  versions: [
    {
      contentHash: `git:${"1".repeat(40)}`,
      provisional: true,
      parent: null,
      change: "created",
      actor: { kind: "human" },
      rationale: "Seed",
    },
  ],
};

async function validate(...argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(argv, { out: (t) => out.push(t), err: (t) => err.push(t) });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

describe("scripts/validate.ts", () => {
  it("passes a valid store", async () => {
    const result = await validate("--root", await repoWith(goodUnit));
    expect(result).toMatchObject({ code: 0, out: "Checked 1 unit(s): 0 error(s), 0 warning(s)." });
  });

  it("exits 1 and reports problems", async () => {
    const result = await validate("--root", await repoWith({ ...goodUnit, location: { file: "missing.ts" } }));
    expect(result.code).toBe(1);
    expect(result.err).toContain("location.file missing.ts does not exist");
  });

  it("emits JSON for agents", async () => {
    const result = await validate("--json", "--root", await repoWith(goodUnit));
    expect(JSON.parse(result.out)).toEqual({ units: 1, problems: [] });
  });

  it("validates this repository's own store", async () => {
    expect((await validate()).err).toBe("");
  });

  it("runs directly under Node with type stripping", () => {
    const output = execFileSync(process.execPath, ["--conditions=poetics-source", "scripts/validate.ts", "--json"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    expect(JSON.parse(output).problems).toEqual([]);
  });
});

describe("scripts/reindex.ts", () => {
  it("builds the index and is incremental on the second run", async () => {
    const root = await repoWith(goodUnit);
    expect(await reindex(root, false)).toEqual({ added: 1, updated: 0, removed: 0, unchanged: 0 });
    expect(await reindex(root, false)).toEqual({ added: 0, updated: 0, removed: 0, unchanged: 1 });
    expect(await reindex(root, true)).toEqual({ added: 1, updated: 0, removed: 0, unchanged: 0 });
  });
});

describe("scripts/mint-uid.ts", () => {
  it("mints the requested number of distinct uids", () => {
    const uids = mintUids(3);
    expect(uids).toHaveLength(3);
    expect(new Set(uids).size).toBe(3);
    expect(uids.every(isUid)).toBe(true);
  });

  it("rejects bad counts", () => {
    expect(() => mintUids(0)).toThrow(RangeError);
    expect(() => mintUids(Number.NaN)).toThrow(RangeError);
  });
});

describe("scripts/provisional-hash.ts", () => {
  const source = "import x from 'y';\nexport function a() {\n  return 1;\n}\n";

  it("hashes the line range without a trailing newline", async () => {
    const { gitBlobHash } = await import("@poetics/core");
    expect(provisionalHash(source, 2, 4)).toBe(gitBlobHash("export function a() {\n  return 1;\n}"));
  });

  it("rejects ranges outside the file", () => {
    expect(() => provisionalHash(source, 0, 1)).toThrow(RangeError);
    expect(() => provisionalHash(source, 3, 2)).toThrow(RangeError);
    expect(() => provisionalHash(source, 1, 99)).toThrow(RangeError);
  });
});
