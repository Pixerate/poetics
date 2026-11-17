// A stand-in out-of-process adapter for tests (ADR 0025). Its first argument is
// the mode: `echo` reads each file (its text when given, else from disk) and
// makes a unit of every `func name() {` block, with `calls` edges to other
// functions it calls by name; `replay <file>` writes that response verbatim;
// the rest misbehave in one way each, so the runner's checks can be tested.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const [mode, arg] = process.argv.slice(2);
const request = JSON.parse(readFileSync(0, "utf8"));
const b3 = (text) => `b3:${createHash("sha256").update(text).digest("hex")}`;
const out = (value) => process.stdout.write(typeof value === "string" ? value : JSON.stringify(value));

if (mode === "replay") out(readFileSync(arg, "utf8"));
else if (mode === "exit") {
  process.stderr.write("swift-syntax: could not load the toolchain\n");
  process.exit(3);
} else if (mode === "garbage") out("not json");
else if (mode === "sleep") setTimeout(() => out({}), 10_000);
else if (mode === "bad-shape") out({ protocol: 1, adapter: { name: "swift", version: "0", rules: 1 }, files: [{ path: request.files[0].path }] });
else if (mode === "unrequested") out({ protocol: 1, adapter: { name: "swift", version: "0", rules: 1 }, files: [{ path: "elsewhere.swift", units: [] }] });
else {
  const name = mode === "wrong-name" ? "kotlin" : "swift";
  const files = request.files.map(({ path, text }) => {
    const source = text ?? readFileSync(join(request.root, path), "utf8");
    if (source.includes("#unreadable")) return { path, error: "could not parse" };
    const lines = source.split("\n");
    const units = [];
    lines.forEach((line, i) => {
      const match = /^func (\w+)\(\) \{/.exec(line);
      if (!match) return;
      let end = i;
      while (end < lines.length - 1 && lines[end] !== "}") end++;
      const body = lines.slice(i, end + 1).join("\n");
      units.push({ key: `${path}#${match[1]}()`, name: `${match[1]}()`, kind: "function", framework: "none", startLine: i + 1, endLine: end + 1, contentHash: b3(body.replace(/\s+/g, " ")), interfaceHash: b3(line), fingerprint: [], signatureText: line.replace(/ \{$/, ""), edges: [], unresolved: [], body });
    });
    return { path, units };
  });
  const keyOf = new Map(files.flatMap((file) => (file.units ?? []).map((unit) => [unit.name.slice(0, -2), unit.key])));
  for (const file of files) {
    for (const unit of file.units ?? []) {
      for (const [, called] of unit.body.matchAll(/(\w+)\(\)/g)) {
        const to = keyOf.get(called);
        if (to && to !== unit.key) unit.edges.push({ to, kind: "calls", resolution: "name" });
      }
      delete unit.body;
    }
  }
  out({ protocol: 1, adapter: { name, version: "0.0.0", rules: 1 }, files });
}
