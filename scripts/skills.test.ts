import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SKILLS_MIRRORS, skillsDrift, syncSkills } from "./skills.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function put(root: string, file: string, text: string): Promise<void> {
  await mkdir(dirname(join(root, file)), { recursive: true });
  await writeFile(join(root, file), text);
}

async function repo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "poetics-skills-"));
  await put(root, ".agents/skills/a/SKILL.md", "---\nname: a\n---\n");
  await put(root, ".agents/skills/b/SKILL.md", "---\nname: b\n---\n");
  return root;
}

describe("syncSkills", () => {
  it("writes a missing mirror, after which the check passes", async () => {
    const root = await repo();
    expect(await syncSkills(root, true)).toEqual({ ".claude/skills": ["a/SKILL.md", "b/SKILL.md"] });
    await syncSkills(root, false);
    expect(await readFile(join(root, ".claude/skills/b/SKILL.md"), "utf8")).toBe("---\nname: b\n---\n");
    expect(await syncSkills(root, true)).toEqual({ ".claude/skills": [] });
  });

  it("reports edited and extra mirror files, and removes the extras when it writes", async () => {
    const root = await repo();
    await syncSkills(root, false);
    await put(root, ".claude/skills/a/SKILL.md", "edited in the mirror\n");
    await put(root, ".claude/skills/stray/SKILL.md", "only in the mirror\n");
    expect(await skillsDrift(root, ".claude/skills")).toEqual(["a/SKILL.md", "stray/SKILL.md"]);
    await syncSkills(root, false);
    expect(await skillsDrift(root, ".claude/skills")).toEqual([]);
    await expect(readFile(join(root, ".claude/skills/stray/SKILL.md"))).rejects.toThrow();
  });

  it("does not write when checking", async () => {
    const root = await repo();
    await syncSkills(root, true);
    await expect(readFile(join(root, ".claude/skills/a/SKILL.md"))).rejects.toThrow();
  });

  it("refuses a repository with no skills, rather than emptying the mirror", async () => {
    const root = await mkdtemp(join(tmpdir(), "poetics-skills-"));
    await expect(syncSkills(root, false)).rejects.toThrow("No skills in .agents/skills/.");
  });

  it("keeps this repository's mirrors identical to .agents/skills", async () => {
    for (const mirror of SKILLS_MIRRORS) expect(await skillsDrift(REPO_ROOT, mirror)).toEqual([]);
  });
});
