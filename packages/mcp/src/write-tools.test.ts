import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyIndex, planIndex } from "@poetics/cli";
import type { Note, Unit } from "@poetics/core";
import { createServer } from "./server.ts";

const CONFIG = { version: 1, adapters: ["typescript"], include: ["src/**/*.ts"] };
const TOTAL = (name: string) => `export function ${name}(items: number[], rate: number): number {\n  let sum = 0;\n  for (const item of items) {\n    if (item <= 0) continue;\n    sum += item;\n  }\n  return sum + Math.round(sum * rate * 100) / 100;\n}\n`;
const session = { tool: "claude-code", model: "claude-opus-5-5" };

const git = (root: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], { cwd: root, stdio: "ignore" });

async function write(root: string, file: string, text: string) {
  await mkdir(dirname(join(root, file)), { recursive: true });
  await writeFile(join(root, file), text);
}

/** A committed repo whose store poetics index made from `files`. */
async function repo(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "poetics-mcp-write-"));
  git(root, "init", "-q", "-b", "main");
  await write(root, ".poetics/config.json", JSON.stringify(CONFIG));
  await write(root, ".gitignore", ".poetics/cache/\n");
  for (const [file, text] of Object.entries(files)) await write(root, file, text);
  await applyIndex(root, await planIndex(root, CONFIG, { rationale: "Seed" }), { kind: "human" });
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "Seed");
  return root;
}

async function units(root: string): Promise<Map<string, Unit>> {
  const dir = join(root, ".poetics/units");
  return new Map(
    await Promise.all((await readdir(dir)).map(async (f) => JSON.parse(await readFile(join(dir, f), "utf8")) as Unit)).then((all) => all.map((u) => [u.name, u])),
  );
}

describe("poetics_record_rationale", () => {
  it("gives the newest uncommitted version its own reason, attributed to the session, and refuses a committed one", async () => {
    const root = await repo({ "src/a.ts": TOTAL("total") });
    const server = createServer({ root, session });
    await expect(server.callTool("poetics_record_rationale", { unit: "total", rationale: "Late." })).rejects.toThrow("is committed");

    await write(root, "src/a.ts", TOTAL("total").replace("sum += item;", "sum += item * 2;"));
    await applyIndex(root, await planIndex(root, CONFIG, { rationale: "Run-wide" }), { kind: "agent", tool: "claude-code", reviewed: false });
    const result = await server.callTool("poetics_record_rationale", { unit: "total", rationale: "Doubles each item for the bulk discount.", links: ["#42"] });
    expect(result).toMatchObject({ name: "total", version: 1, rationale: "Doubles each item for the bulk discount." });
    expect((await units(root)).get("total")!.versions[1]).toMatchObject({ rationale: "Doubles each item for the bulk discount.", links: ["#42"] });
  });
});

describe("poetics_declare_lineage", () => {
  it("settles a queued move, checked against the code, and refuses one the code disagrees with", async () => {
    const pair = TOTAL("total") + TOTAL("totalWithTax");
    const root = await repo({ "src/cart.ts": pair });
    await rm(join(root, "src/cart.ts"));
    await write(root, "src/sums.ts", TOTAL("sum") + TOTAL("sumWithTax"));
    const server = createServer({ root, session });
    await expect(server.callTool("poetics_declare_lineage", { kind: "move", from: ["total"], to: ["src/sums.ts#nope"] })).rejects.toThrow("Declaration rejected");
    await expect(server.callTool("poetics_declare_lineage", { kind: "move", from: ["total"], to: ["src/sums.ts"] })).rejects.toThrow("file#name");

    const result = (await server.callTool("poetics_declare_lineage", { kind: "move", from: ["total"], to: ["src/sums.ts#sum"] })) as { moved: Array<{ to: string }> };
    expect(result.moved.map((m) => m.to)).toEqual(["src/sums.ts#sum"]);
    const sum = (await units(root)).get("sum")!;
    expect(sum).toMatchObject({ location: { file: "src/sums.ts" }, lineage: [{ kind: "move", from: "src/cart.ts" }, { kind: "rename", from: "total" }] });
  });
});

describe("poetics_record_note", () => {
  it("records a note anchored at its units' current versions, refreshes GOTCHAS.md, and confirms it later", async () => {
    const root = await repo({ "src/a.ts": TOTAL("total") });
    await write(root, "GOTCHAS.md", "old\n");
    const server = createServer({ root, session });
    const args = { kind: "gotcha", area: "tooling", title: "Totals round twice", symptoms: ["expected 1.01 to be 1"], cause: "Rounding happens in two places.", fix: "Round once, at the end.", anchors: { units: ["total"], paths: ["src/a.ts"] } };
    const recorded = (await server.callTool("poetics_record_note", args)) as { id: string; gotchas: string };
    expect(recorded.gotchas).toBe("updated");
    const note = JSON.parse(await readFile(join(root, ".poetics/notes", `${recorded.id}.json`), "utf8")) as Note;
    const total = (await units(root)).get("total")!;
    expect(note).toMatchObject({ status: "active", actor: { kind: "agent", tool: "claude-code", model: "claude-opus-5-5", reviewed: false }, anchors: { units: [{ uid: total.uid, observedAt: total.versions[0]!.contentHash }], paths: ["src/a.ts"] } });
    expect(await readFile(join(root, "GOTCHAS.md"), "utf8")).toContain("Totals round twice");

    expect(await server.callTool("poetics_record_note", { confirm: recorded.id })).toMatchObject({ id: recorded.id, confirmed: true });
    await expect(server.callTool("poetics_record_note", { ...args, kind: "rumour" })).rejects.toThrow("kind must be one of");
    await expect(server.callTool("poetics_record_note", { ...args, symptoms: "one" })).rejects.toThrow("symptoms must be an array");
  });
});

describe("attribution", () => {
  it("names the connecting client when the server has no session", async () => {
    const root = await repo({ "src/a.ts": TOTAL("total") });
    const input = new PassThrough();
    const output = new PassThrough();
    let text = "";
    output.on("data", (chunk: Buffer) => (text += chunk.toString()));
    const done = createServer({ root }).listen({ input, output });
    const note = { kind: "invariant", area: "store", title: "Keep it", symptoms: [], cause: "Because.", fix: "Keep it." };
    input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "some-agent", version: "1" } } })}\n`);
    input.end(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "poetics_record_note", arguments: note } })}\n`);
    await done;
    const reply = text.trim().split("\n").map((line) => JSON.parse(line) as { id: number; result: { content: Array<{ text: string }> } }).find((r) => r.id === 2)!;
    const { id } = JSON.parse(reply.result.content[0]!.text) as { id: string };
    expect((JSON.parse(await readFile(join(root, ".poetics/notes", `${id}.json`), "utf8")) as Note).actor).toEqual({ kind: "agent", tool: "some-agent", reviewed: false });
  });
});
