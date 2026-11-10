import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The text of the workflow step named `name`, up to the next step. */
function step(workflow: string, name: string): string {
  const start = workflow.indexOf(`- name: ${name}`);
  if (start === -1) throw new Error(`No step named ${name}`);
  const next = workflow.indexOf("\n      - name:", start + 1);
  return workflow.slice(start, next === -1 ? undefined : next);
}

describe("release.yml", () => {
  const workflow = readFileSync(join(REPO_ROOT, ".github/workflows/release.yml"), "utf8");
  const changesets = JSON.parse(readFileSync(join(REPO_ROOT, ".changeset/config.json"), "utf8")) as { changelog: unknown };

  it("gives the version step a GitHub token when changelogs come from GitHub", () => {
    // Without it `changeset version` fails before anything is published, and every release stalls.
    const github = JSON.stringify(changesets.changelog).includes("@changesets/changelog-github");
    const version = step(workflow, "Version packages & update CHANGELOG.md files");
    expect(version).toContain("run: pnpm version-packages");
    if (github) expect(version).toMatch(/\n\s+GITHUB_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/);
  });
});
