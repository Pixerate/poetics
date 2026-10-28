import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COMMANDS } from "./commands.ts";
import { VERSION, run } from "./run.ts";

async function exec(...argv: string[]) {
  return execIn(process.cwd(), ...argv);
}

async function execIn(root: string, ...argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(argv, { out: (t) => out.push(t), err: (t) => err.push(t) }, root);
  return { code, out: out.join("\n"), err: err.join("\n") };
}

describe("poetics CLI", () => {
  it("prints help with every command", async () => {
    const { code, out } = await exec();
    expect(code).toBe(0);
    for (const command of COMMANDS) expect(out).toContain(command.usage);
  });

  it("prints help as JSON for agents", async () => {
    const { out } = await exec("help", "--json");
    expect(JSON.parse(out)).toEqual({ version: VERSION, commands: COMMANDS });
  });

  it("prints the version matching package.json", async () => {
    const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    expect((await exec("--version")).out).toBe(pkg.version);
  });

  it("exits 2 for unknown commands", async () => {
    const { code, err } = await exec("frobnicate", "--json");
    expect(code).toBe(2);
    expect(JSON.parse(err)).toMatchObject({ error: "unknown-command" });
  });

  describe("changes", () => {
    // Signing off and a fixed identity, so tests never prompt the user's signer.
    const git = (root: string, ...args: string[]) =>
      execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args], {
        cwd: root,
        encoding: "utf8",
      });
    const unit = (rationales: string[]) => ({
      uid: "01JB8K0000000000000000000A",
      kind: "function",
      framework: "none",
      name: "formatPrice",
      location: { file: "src/price.ts" },
      versions: rationales.map((rationale, i) => ({
        contentHash: `git:${String(i + 1).repeat(40)}`,
        provisional: true,
        parent: i === 0 ? null : `git:${String(i).repeat(40)}`,
        change: i === 0 ? "created" : "behaviour",
        actor: { kind: "human" },
        rationale,
      })),
    });

    async function repo(): Promise<string> {
      const root = await mkdtemp(join(tmpdir(), "poetics-cli-"));
      await mkdir(join(root, ".poetics", "units"), { recursive: true });
      const file = join(root, ".poetics", "units", "01JB8K0000000000000000000A.json");
      await writeFile(file, JSON.stringify(unit(["Seed"])));
      git(root, "init", "-q", "-b", "main");
      git(root, "add", "-A");
      git(root, "commit", "-q", "-m", "Seed");
      await writeFile(file, JSON.stringify(unit(["Seed", "Round half up"])));
      git(root, "commit", "-q", "-am", "Fix rounding");
      return root;
    }

    it("prints the changes between two refs", async () => {
      const root = await repo();
      const { code, out } = await execIn(root, "changes", "HEAD~1", "HEAD");
      expect(code).toBe(0);
      expect(out).toContain("Fix rounding\n  ~ formatPrice (function, src/price.ts) behaviour\n      Round half up");
    });

    it("prints the change set as JSON for agents", async () => {
      const root = await repo();
      const { out } = await execIn(root, "changes", "HEAD~1", "HEAD", "--json");
      expect(JSON.parse(out)).toMatchObject({ commits: [{ subject: "Fix rounding", units: [{ name: "formatPrice" }] }], unrecorded: [] });
    });

    it("exits 2 for unknown refs, extra arguments and the planned --impact", async () => {
      const root = await repo();
      expect(JSON.parse((await execIn(root, "changes", "nope", "--json")).err)).toMatchObject({
        error: "invalid-argument",
        message: "Unknown git ref: nope",
      });
      expect((await execIn(root, "changes", "a", "b", "c")).code).toBe(2);
      expect(JSON.parse((await execIn(root, "changes", "--impact", "--json")).err)).toMatchObject({ error: "not-implemented" });
    });
  });

  it("exits 2 with a structured error for planned commands", async () => {
    const { code, err } = await exec("verify", "--json");
    expect(code).toBe(2);
    expect(JSON.parse(err)).toMatchObject({ error: "not-implemented", command: "verify" });
  });
});
