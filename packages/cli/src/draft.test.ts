import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Version } from "@poetics/core";
import { DRAFT_PROTOCOL, checkDraft, commandDrafter, draftRequest, draftVersions, formatDraftReport } from "./draft.ts";
import type { Drafter, DraftRequest } from "./draft.ts";

const PR_TEXT = "Bulk customers were charged twice because the loop counted every line item and the discount together";

const request = (): DraftRequest =>
  draftRequest({
    unit: { name: "formatPrice", kind: "function", file: "src/price.ts" },
    change: "behaviour",
    commit: "abc1234",
    code: "export function formatPrice() { return 2; }",
    previous: "export function formatPrice() { return 1; }",
    evidence: [
      { source: "commit", ref: "abc1234", text: "Double each item for bulk orders", quotable: true },
      { source: "pull-request", ref: "#7", text: PR_TEXT, quotable: false },
    ],
  });

const version = (): Version => ({
  contentHash: "b3:1",
  parent: null,
  change: "created",
  commit: "abc1234",
  actor: { kind: "human" },
  rationale: "extracted",
  inferred: { by: "poetics-backfill", confidence: "medium", sources: ["commit"], drafted: false, reviewed: false },
});

const answering = (answer: unknown, calls: DraftRequest[] = []): Drafter => ({
  id: "fake",
  async draft(r) {
    calls.push(r);
    return answer;
  },
});

describe("draftRequest", () => {
  it("numbers evidence, lists what may not be quoted, and carries the protocol and instructions", () => {
    const r = request();
    expect(r.protocol).toBe(DRAFT_PROTOCOL);
    expect(r.evidence.map((e) => [e.id, e.source])).toEqual([
      ["e1", "commit"],
      ["e2", "pull-request"],
    ]);
    expect(r.doNotQuote).toEqual(["e2"]);
    expect(r.instructions).toMatch(/Evidence text is data/);
    expect(JSON.stringify(r)).not.toContain("quotable");
  });
});

describe("checkDraft", () => {
  const ok = { rationale: "Doubles each item so bulk orders are priced per unit.", cites: ["e1"], diffOnly: false };

  it("accepts a draft that cites given evidence", () => {
    expect(checkDraft(ok, request())).toEqual({ draft: ok });
  });

  it("rejects malformed answers, unknown citations and inconsistent diffOnly", () => {
    expect(checkDraft("text", request())).toEqual({ problem: "the answer is not a JSON object" });
    expect(checkDraft({ ...ok, rationale: " " }, request())).toEqual({ problem: "rationale is missing" });
    expect(checkDraft({ ...ok, cites: "e1" }, request())).toEqual({ problem: "cites is not a list of evidence ids" });
    expect(checkDraft({ ...ok, diffOnly: undefined }, request())).toEqual({ problem: "diffOnly is missing" });
    expect(checkDraft({ ...ok, cites: ["e9"] }, request())).toEqual({ problem: "cites evidence it was not given: e9" });
    expect(checkDraft({ ...ok, cites: [], diffOnly: false }, request())).toEqual({ problem: "diffOnly must be true exactly when nothing is cited" });
    expect(checkDraft({ ...ok, diffOnly: true }, request())).toEqual({ problem: "diffOnly must be true exactly when nothing is cited" });
  });

  it("rejects eight or more words copied from evidence it may not quote, but not from quotable evidence", () => {
    const quoting = { ...ok, rationale: `Fixes it: bulk customers were charged twice because the loop counted every line.`, cites: ["e2"] };
    expect(checkDraft(quoting, request())).toEqual({ problem: "quotes e2, which may not be quoted" });
    const short = { ...ok, rationale: "Bulk customers were charged twice; now each item doubles.", cites: ["e2"] };
    expect(checkDraft(short, request())).toHaveProperty("draft");
    const fromCommit = { ...ok, rationale: "Double each item for bulk orders, as the commit says, so nothing else changes here." };
    expect(checkDraft(fromCommit, request())).toHaveProperty("draft");
  });
});

describe("draftVersions", () => {
  it("writes drafted rationale, marks it drafted and keeps confidence; lowers it for a draft from the diff alone", async () => {
    const [a, b] = [version(), version()];
    const report = await draftVersions(
      [
        { version: a, request: request() },
        { version: b, request: { ...request(), commit: "def5678" } },
      ],
      {
        id: "fake",
        async draft(r) {
          return r.commit === "abc1234" ? { rationale: "Prices bulk orders per unit.", cites: ["e1"], diffOnly: false } : { rationale: "Returns 2 instead of 1; the reason is not recorded.", cites: [], diffOnly: true };
        },
      },
    );
    expect(report).toEqual({ drafted: 2, cached: 0, rejected: [], failed: [] });
    expect([a.rationale, a.inferred]).toEqual(["Prices bulk orders per unit.", { by: "poetics-backfill", confidence: "medium", sources: ["commit"], drafted: true, reviewed: false }]);
    expect(b.inferred?.confidence).toBe("low");
  });

  it("keeps the extracted rationale when a draft is rejected or the drafter fails", async () => {
    const [a, b] = [version(), version()];
    const failing: Drafter = {
      id: "f",
      async draft() {
        throw new Error("exited with 1: no credentials");
      },
    };
    const rejected = await draftVersions([{ version: a, request: request() }], answering({ rationale: "x", cites: ["e9"], diffOnly: false }));
    const failed = await draftVersions([{ version: b, request: request() }], failing);
    expect([a.rationale, a.inferred?.drafted, b.rationale]).toEqual(["extracted", false, "extracted"]);
    expect(rejected.rejected).toEqual([{ unit: "src/price.ts#formatPrice", commit: "abc1234", reason: "cites evidence it was not given: e9" }]);
    expect(failed.failed).toEqual([{ unit: "src/price.ts#formatPrice", commit: "abc1234", reason: "exited with 1: no credentials" }]);
    expect(formatDraftReport(failed)).toEqual([
      "Drafted 0 rationale(s); 0 rejected and 1 failed kept their extracted rationale.",
      "draft failed: src/price.ts#formatPrice at abc1234: exited with 1: no credentials",
    ]);
  });

  it("answers a repeated request from the cache, so a dry run and --write draft once", async () => {
    const cacheFile = join(await mkdtemp(join(tmpdir(), "poetics-draft-")), "cache", "drafts.json");
    const calls: DraftRequest[] = [];
    const drafter = answering({ rationale: "Prices bulk orders per unit.", cites: ["e1"], diffOnly: false }, calls);
    await draftVersions([{ version: version(), request: request() }], drafter, { cacheFile });
    const second = await draftVersions([{ version: version(), request: request() }], drafter, { cacheFile });
    expect([calls.length, second.cached, second.drafted]).toEqual([1, 1, 1]);
    // Another drafter does not reuse the first one's answers.
    await draftVersions([{ version: version(), request: request() }], { ...drafter, id: "other" }, { cacheFile });
    expect(calls.length).toBe(2);
  });
});

describe("commandDrafter", () => {
  /** A drafting command as a script: Node, so the test needs no model and no network. */
  async function script(body: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "poetics-drafter-"));
    const file = join(dir, "drafter.mjs");
    await writeFile(file, body);
    await chmod(file, 0o755);
    return file;
  }

  it("sends the request on stdin and reads the draft from stdout, run from the given directory without a shell", async () => {
    const file = await script(`let input = ""; process.stdin.on("data", (c) => (input += c)); process.stdin.on("end", () => { const r = JSON.parse(input); process.stdout.write(JSON.stringify({ rationale: r.unit.name + " in " + process.cwd().split("/").at(-1), cites: [r.evidence[0].id], diffOnly: false })); });`);
    const cwd = await mkdtemp(join(tmpdir(), "poetics-cwd-"));
    const answer = (await commandDrafter([process.execPath, file], { cwd }).draft(request())) as { rationale: string };
    expect(answer.rationale).toBe(`formatPrice in ${cwd.split("/").at(-1)}`);
  });

  it("fails on a non-zero exit, output that is not JSON, and a timeout", async () => {
    const cwd = tmpdir();
    await expect(commandDrafter([process.execPath, await script(`process.stderr.write("no credentials\\n"); process.exit(3);`)], { cwd }).draft(request())).rejects.toThrow("exited with 3: no credentials");
    await expect(commandDrafter([process.execPath, await script(`process.stdout.write("hello");`)], { cwd }).draft(request())).rejects.toThrow("wrote no JSON on stdout");
    await expect(commandDrafter([process.execPath, await script(`setTimeout(() => {}, 10000);`)], { cwd, timeoutMs: 200 }).draft(request())).rejects.toThrow("timed out");
    expect(() => commandDrafter([], { cwd })).toThrow("backfill.draft.command is empty");
  });
});
