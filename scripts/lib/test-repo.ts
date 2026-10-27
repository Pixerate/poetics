// Throwaway git repositories for tests. Signing is disabled so tests never
// prompt a user's signing agent (e.g. 1Password).
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gitBlobHash } from "@poetics/core";
import type { Unit } from "@poetics/core";

export const SCOPE = { include: ["src/**/*.ts"], exclude: ["**/*.test.ts"] };

export function runGit(root: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", ...args],
    { cwd: root, encoding: "utf8" },
  );
}

export async function write(root: string, path: string, content: string): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), content);
}

export async function writeUnitFile(root: string, unit: Unit): Promise<void> {
  await write(root, `.poetics/units/${unit.uid}.json`, `${JSON.stringify(unit, null, 2)}\n`);
}

export const FN_A = "export function a() {\n  return 1;\n}";

export function unitFor(uid: string, name: string, source: string, extra: Partial<Unit> = {}): Unit {
  return {
    uid,
    kind: "function",
    framework: "none",
    name,
    location: { file: "src/a.ts" },
    versions: [
      {
        contentHash: gitBlobHash(source),
        provisional: true,
        parent: null,
        change: "created",
        actor: { kind: "human" },
        rationale: `Create ${name}`,
        links: [{ kind: "plan", ref: "docs/plan.md" }],
      },
    ],
    tests: [{ file: "src/a.test.ts", via: "static" }],
    ...extra,
  };
}

/** A committed repo with src/a.ts exporting `a`, its unit and its test. */
export async function makeGitRepo(uid: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "poetics-git-"));
  runGit(root, "init", "-q", "-b", "main");
  await write(root, "src/a.ts", `${FN_A}\n`);
  await write(root, "src/a.test.ts", "// test\n");
  await writeUnitFile(root, unitFor(uid, "a", FN_A));
  runGit(root, "add", "-A");
  runGit(root, "commit", "-q", "-m", "base");
  return root;
}
