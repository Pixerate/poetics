import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { COMMANDS } from "./commands.ts";
import { VERSION, run } from "./run.ts";

async function exec(...argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(argv, { out: (t) => out.push(t), err: (t) => err.push(t) });
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

  it("exits 2 with a structured error for planned commands", async () => {
    const { code, err } = await exec("verify", "--json");
    expect(code).toBe(2);
    expect(JSON.parse(err)).toMatchObject({ error: "not-implemented", command: "verify" });
  });
});
