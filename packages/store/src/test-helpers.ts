import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Note, Unit } from "@poetics/core";

export const REPO_SCHEMAS = join(dirname(fileURLToPath(import.meta.url)), "../../../schemas");

export const UID_A = "01JB8K0000000000000000000A";
export const UID_B = "01JB8K0000000000000000000B";
export const UID_C = "01JB8K0000000000000000000C";
export const NOTE_ID = "01JB8N0000000000000000000N";

export const hash = (char: string, family: "git" | "b3" = "git") =>
  (family === "git" ? `git:${char.repeat(40)}` : `b3:${char.repeat(64)}`) as `git:${string}`;

export function makeUnit(uid: string, overrides: Partial<Unit> = {}): Unit {
  return {
    uid,
    kind: "function",
    framework: "none",
    name: `fn${uid.slice(-1)}`,
    location: { file: "src/lib.ts" },
    versions: [
      {
        contentHash: hash("1"),
        provisional: true,
        parent: null,
        change: "created",
        actor: { kind: "agent", tool: "claude-code", reviewed: false },
        rationale: "Seed",
      },
    ],
    ...overrides,
  };
}

/** A throwaway repo with `.poetics/config.json`, `src/lib.ts` and the given units. */
export async function makeRepo(units: Unit[], config: object = defaultConfig()): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "poetics-store-"));
  await mkdir(join(root, ".poetics", "units"), { recursive: true });
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "lib.ts"), "export {};\n");
  await writeFile(join(root, ".poetics", "config.json"), JSON.stringify(config));
  for (const unit of units) await writeUnit(root, unit);
  return root;
}

export async function writeUnit(root: string, unit: Unit, path = join(".poetics", "units", `${unit.uid}.json`)): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), `${JSON.stringify(unit, null, 2)}\n`);
}

export function defaultConfig(): object {
  return { version: 1, adapters: ["typescript"], include: ["src/**"], policy: { allowProvisionalHashes: true } };
}

export function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: NOTE_ID,
    kind: "gotcha",
    area: "tooling",
    title: "Something surprising",
    symptoms: ["Error: boom"],
    cause: "Because.",
    fix: "Do the other thing.",
    anchors: {},
    status: "active",
    actor: { kind: "human" },
    ...overrides,
  };
}

export async function writeNote(root: string, note: Note, path = join(".poetics", "notes", `${note.id}.json`)): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), `${JSON.stringify(note, null, 2)}\n`);
}

/**
 * Runs git in a test repo. Signing is disabled and the identity fixed so tests
 * never prompt the user's signer (see the note on signing in GOTCHAS.md).
 */
export function runGit(root: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", ...args],
    { cwd: root, encoding: "utf8" },
  );
}

/** Stages everything and commits it with `message`. */
export function commitAll(root: string, message: string): void {
  runGit(root, "add", "-A");
  runGit(root, "commit", "-q", "-m", message);
}
