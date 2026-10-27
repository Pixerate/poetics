import { describe, expect, it } from "vitest";
import { main } from "./check.ts";
import { coverageFor } from "./coverage.ts";
import { FN_A, makeGitRepo, write } from "./lib/test-repo.ts";

const UID = "01JB8K0000000000000000000A";
const config = JSON.stringify({ version: 1, adapters: ["typescript"], include: ["src/**/*.ts"], exclude: ["**/*.test.ts"] });

async function run(root: string, ...argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(argv, { out: (t) => out.push(t), err: (t) => err.push(t) }, root);
  return { code, out: out.join("\n"), err: err.join("\n") };
}

describe("scripts/check.ts", () => {
  it("passes a clean tree and fails an unrecorded change", async () => {
    const root = await makeGitRepo(UID);
    await write(root, ".poetics/config.json", config);
    expect((await run(root)).code).toBe(0);

    await write(root, "src/a.ts", FN_A.replace("1", "2"));
    const result = await run(root);
    expect(result.code).toBe(1);
    expect(result.err).toContain("error: stale: src/a.ts");
    expect(result.out).toMatch(/1 code file\(s\), 0 unit file\(s\) changed; 1 error\(s\), 0 warning\(s\)/);
  });

  it("emits JSON", async () => {
    const root = await makeGitRepo(UID);
    await write(root, ".poetics/config.json", config);
    expect(JSON.parse((await run(root, "--json", "--since", "HEAD")).out)).toMatchObject({ findings: [] });
  });
});

describe("scripts/coverage.ts", () => {
  it("reports coverage for a repo and applies thresholds from config", async () => {
    const root = await makeGitRepo(UID);
    await write(root, "src/b.ts", "export function b() {}\n");
    await write(
      root,
      ".poetics/config.json",
      JSON.stringify({ ...JSON.parse(config), policy: { coverage: { tracked: 1 } } }),
    );
    const report = await coverageFor(root);
    expect(report.overall.tracked).toEqual({ covered: 1, total: 2, ratio: 0.5 });
    expect(report.overall.fresh.ratio).toBe(1);
    expect(report.failures.map((f) => f.metric)).toEqual(["tracked"]);
  });
});
