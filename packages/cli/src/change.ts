// The per-change check: did this commit, branch or working tree record its
// code changes in .poetics/ properly? A day-one stand-in for the part of
// `poetics verify` and the GitHub Action that review a diff.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { createMatcher, extendsPrehistory, parseUnit, readUnitFiles, storePaths } from "@poetics/store";
import type { Scope } from "@poetics/store";
import type { Unit } from "@poetics/core";
import { declarationsIn } from "./declarations.ts";
import { pluginsFor } from "./frameworks.ts";
import type { Declaration } from "./declarations.ts";
import { DRIFT_SEVERITY, compareCodeWithStore } from "./drift.ts";
import { changesSince, showAt } from "./git.ts";

export type ChangeFindingKind =
  | "untracked"
  | "stale"
  | "orphaned"
  | "duplicate"
  | "rewritten-history"
  | "changed-rehash"
  | "deleted-unit"
  | "missing-lineage"
  | "no-links"
  | "unverified"
  | "callers-not-updated"
  | "repeated-rationale";

export interface ChangeFinding {
  severity: "error" | "warning";
  kind: ChangeFindingKind;
  file: string;
  message: string;
}

export interface ChangeReport {
  base: string;
  changedCodeFiles: string[];
  changedUnits: number;
  findings: ChangeFinding[];
}

const PARSEABLE = /\.(ts|tsx|mts|cts)$/;

export async function checkChange(root: string, since: string, scope: Scope & { adapters?: readonly string[] }): Promise<ChangeReport> {
  const plugins = pluginsFor(scope);
  const { base, changes } = changesSince(root, since);
  const inScope = createMatcher(scope.include, scope.exclude ?? []);
  const changedPaths = new Set(changes.flatMap((c) => (c.from ? [c.path, c.from] : [c.path])));
  const findings: ChangeFinding[] = [];

  // 1. Code that changed must match the store.
  const codeFiles = [...changedPaths].filter((path) => inScope(path) && PARSEABLE.test(path) && !path.endsWith(".d.ts")).sort();
  const declarations: Declaration[] = [];
  for (const file of codeFiles) {
    const text = await readFile(join(root, file), "utf8").catch(() => undefined);
    if (text !== undefined) declarations.push(...declarationsIn(file, text, plugins));
  }
  const paths = storePaths(root);
  const units = (await readUnitFiles(paths)).map(parseUnit);
  const covered = new Set(codeFiles);
  for (const finding of compareCodeWithStore(declarations, units, (file) => covered.has(file)).findings) {
    findings.push({ severity: DRIFT_SEVERITY[finding.kind], kind: finding.kind, file: finding.file, message: finding.message });
  }

  // 2. Unit files that changed must only append, and say why.
  const unitChanges = changes.filter((c) => c.path.startsWith(".poetics/units/") && c.path.endsWith(".json"));
  const newVersions: Array<{ unit: Unit; file: string; version: Unit["versions"][number] }> = [];
  for (const change of unitChanges) {
    if (change.status === "D") {
      findings.push({
        severity: "error",
        kind: "deleted-unit",
        file: change.path,
        message: `unit files are never deleted; restore it and append a "removed" version saying why the code went (ADR 0010)`,
      });
      continue;
    }
    const head = parseUnit({ path: join(root, change.path), relativePath: change.path, raw: await readFile(join(root, change.path), "utf8") });
    const baseRaw = change.status === "A" ? undefined : showAt(root, base, change.from ?? change.path);
    const before = baseRaw === undefined ? undefined : (JSON.parse(baseRaw) as Unit);

    if (before) {
      const kept = head.versions.slice(0, before.versions.length);
      if (head.versions.length < before.versions.length || !isDeepStrictEqual(kept, before.versions)) {
        findings.push({
          severity: "error",
          kind: "rewritten-history",
          file: change.path,
          message: `${head.name}: earlier versions were edited or removed; versions are append-only`,
        });
      }
      // Prehistory is write-once: a later backfill may only reach further back, so what was there stays its tail.
      const was = before.prehistory ?? [];
      const now = head.prehistory ?? [];
      if (!extendsPrehistory(was, now)) {
        findings.push({
          severity: "error",
          kind: "rewritten-history",
          file: change.path,
          message: `${head.name}: recorded prehistory was edited or removed; it may only be extended further back`,
        });
      }
      const moved = before.location.file !== head.location.file || before.name !== head.name;
      if (moved && (head.lineage?.length ?? 0) <= (before.lineage?.length ?? 0)) {
        findings.push({
          severity: "error",
          kind: "missing-lineage",
          file: change.path,
          message: `${head.name}: name or location changed (${before.name} in ${before.location.file}) without a lineage entry`,
        });
      }
    }
    for (const version of head.versions.slice(before?.versions.length ?? 0)) newVersions.push({ unit: head, file: change.path, version });
  }

  const rationaleCounts = new Map<string, number>();
  for (const { version } of newVersions) rationaleCounts.set(version.rationale, (rationaleCounts.get(version.rationale) ?? 0) + 1);
  const dependents = (uid: string) => units.filter((u) => Object.hasOwn(u.versions.at(-1)?.deps ?? {}, uid));
  const versioned = new Set(newVersions.map(({ unit }) => unit.uid));

  // Declarations of the files new rehash versions sit in, which need not be among the changed code files.
  const declarationCache = new Map<string, Declaration[]>();
  const declarationsOf = async (file: string) => {
    if (!declarationCache.has(file)) {
      const text = await readFile(join(root, file), "utf8").catch(() => undefined);
      declarationCache.set(file, text === undefined ? [] : declarationsIn(file, text, plugins));
    }
    return declarationCache.get(file)!;
  };

  for (const { unit, file, version } of newVersions) {
    // A rehash claims the code did not change: it must sit on the code's own provisional hash (ADR 0014).
    if (version.change === "rehash" && version === unit.versions.at(-1)) {
      const name = unit.location.export ?? unit.name;
      const decl = (await declarationsOf(unit.location.file)).find((d) => d.name === name && (d.kind === "type") === (unit.kind === "type"));
      if (decl && (decl.hash !== version.parent || decl.contentHash !== version.contentHash)) {
        findings.push({
          severity: "error",
          kind: "changed-rehash",
          file,
          message:
            decl.hash !== version.parent
              ? `${unit.name}: rehash recorded, but the code changed since ${version.parent ?? "its parent"}; record a behaviour, interface or cosmetic version instead`
              : `${unit.name}: rehash contentHash ${version.contentHash} is not the code's ${decl.contentHash}`,
        });
      }
    }
    if (!version.links || version.links.length === 0) {
      findings.push({ severity: "warning", kind: "no-links", file, message: `${unit.name}: new version cites no issue, task, decision or plan section` });
    }
    // Rehash rationale is the same for every unit by design.
    if (version.change !== "rehash" && (rationaleCounts.get(version.rationale) ?? 0) >= 3) {
      findings.push({
        severity: "warning",
        kind: "repeated-rationale",
        file,
        message: `${unit.name}: the same rationale is used for ${rationaleCounts.get(version.rationale)} units; say what changed for this one`,
      });
    }
    if (version.change === "behaviour" || version.change === "interface") {
      const tests = unit.tests ?? [];
      if (tests.length === 0) {
        findings.push({ severity: "warning", kind: "unverified", file, message: `${unit.name}: ${version.change} change but the unit has no linked tests` });
      } else if (!tests.some((test) => changedPaths.has(test.file))) {
        findings.push({
          severity: "warning",
          kind: "unverified",
          file,
          message: `${unit.name}: ${version.change} change but none of its linked tests changed (${tests.map((t) => t.file).join(", ")})`,
        });
      }
    }
    // A removal breaks callers at least as surely as an interface change.
    if (version.change === "interface" || version.change === "removed") {
      for (const caller of dependents(unit.uid)) {
        if (versioned.has(caller.uid)) continue;
        findings.push({
          severity: "warning",
          kind: "callers-not-updated",
          file,
          message: `${unit.name}: ${version.change === "removed" ? "removed" : "interface changed"} but its dependent ${caller.name} got no version`,
        });
      }
    }
  }

  return { base, changedCodeFiles: codeFiles, changedUnits: unitChanges.length, findings };
}
