// How well Poetics covers a codebase: tracked and fresh units, and the quality
// of what is recorded about them.
import type { Note, Unit } from "@poetics/core";
import type { Declaration } from "./declarations.ts";
import { compareCodeWithStore } from "./drift.ts";
import type { CoverageThresholds } from "./config.ts";

export interface Ratio {
  covered: number;
  total: number;
  /** covered / total, or 1 when there is nothing to cover. */
  ratio: number;
}

export interface CoverageMetrics {
  tracked: Ratio;
  fresh: Ratio;
  linkedRationale: Ratio;
  reviewed: Ratio;
  tested: Ratio;
  documented: Ratio;
}

export interface CoverageReport {
  overall: CoverageMetrics;
  /** Keyed by area: `packages/<name>` or the top-level folder. */
  byArea: Record<string, CoverageMetrics>;
  notes: { active: number; withCheck: number; retired: number };
  unsupportedFiles: string[];
  failures: Array<{ metric: keyof CoverageMetrics; ratio: number; threshold: number }>;
}

export const METRICS: ReadonlyArray<readonly [keyof CoverageMetrics, string]> = [
  ["tracked", "Exports with a unit"],
  ["fresh", "Units matching their code"],
  ["linkedRationale", "Versions citing a source"],
  ["reviewed", "Agent versions reviewed"],
  ["tested", "Units with linked tests"],
  ["documented", "Units with docs"],
];

const ratio = (covered: number, total: number): Ratio => ({ covered, total, ratio: total === 0 ? 1 : covered / total });

export function areaOf(file: string): string {
  const parts = file.split("/");
  return parts[0] === "packages" && parts.length > 2 ? `packages/${parts[1]}` : parts[0]!;
}

function metricsFor(declarations: readonly Declaration[], units: readonly Unit[], covers: (file: string) => boolean): CoverageMetrics {
  const drift = compareCodeWithStore(declarations, units, covers);
  const tracked = units.filter((unit) => covers(unit.location.file));
  const versions = tracked.flatMap((unit) => unit.versions);
  const agentVersions = versions.filter((v) => v.actor.kind === "agent");
  return {
    tracked: ratio(drift.tracked, drift.declarations),
    fresh: ratio(drift.fresh, drift.tracked),
    linkedRationale: ratio(versions.filter((v) => (v.links?.length ?? 0) > 0).length, versions.length),
    reviewed: ratio(agentVersions.filter((v) => v.actor.kind === "agent" && v.actor.reviewed).length, agentVersions.length),
    tested: ratio(tracked.filter((unit) => (unit.tests?.length ?? 0) > 0).length, tracked.length),
    documented: ratio(tracked.filter((unit) => (unit.docs ?? "").trim() !== "").length, tracked.length),
  };
}

export function computeCoverage(
  declarations: readonly Declaration[],
  units: readonly Unit[],
  notes: readonly Note[],
  scanned: ReadonlySet<string>,
  unsupportedFiles: readonly string[],
  thresholds: CoverageThresholds = {},
): CoverageReport {
  const covers = (file: string) => scanned.has(file);
  const overall = metricsFor(declarations, units, covers);
  const areas = new Set([...scanned].map(areaOf));
  const byArea: Record<string, CoverageMetrics> = {};
  for (const area of [...areas].sort()) {
    const inArea = (file: string) => covers(file) && areaOf(file) === area;
    byArea[area] = metricsFor(
      declarations.filter((d) => inArea(d.file)),
      units.filter((u) => inArea(u.location.file)),
      inArea,
    );
  }
  const failures = METRICS.flatMap(([metric]) => {
    const threshold = thresholds[metric];
    const value = overall[metric].ratio;
    return threshold !== undefined && value < threshold ? [{ metric, ratio: value, threshold }] : [];
  });
  return {
    overall,
    byArea,
    notes: {
      active: notes.filter((n) => n.status === "active").length,
      withCheck: notes.filter((n) => n.status === "active" && n.check !== undefined).length,
      retired: notes.filter((n) => n.status !== "active").length,
    },
    unsupportedFiles: [...unsupportedFiles],
    failures,
  };
}

const pct = (r: Ratio) => (r.total === 0 ? "—" : `${Math.floor(r.ratio * 1000) / 10}%`).padStart(6);

export function formatCoverage(report: CoverageReport): string {
  const areas = Object.keys(report.byArea);
  const header = ["Metric".padEnd(28), "Overall".padStart(16), ...areas.map((a) => a.padStart(Math.max(a.length, 8)))].join("  ");
  const rows = METRICS.map(([metric, label]) => {
    const overall = report.overall[metric];
    return [
      label.padEnd(28),
      `${pct(overall)} ${`(${overall.covered}/${overall.total})`.padStart(9)}`,
      ...areas.map((a) => pct(report.byArea[a]![metric]).padStart(Math.max(a.length, 8))),
    ].join("  ");
  });
  const lines = [header, ...rows, "", `Notes: ${report.notes.active} active (${report.notes.withCheck} with a check), ${report.notes.retired} retired.`];
  if (report.unsupportedFiles.length > 0) lines.push(`Not yet indexable: ${report.unsupportedFiles.length} file(s) (e.g. ${report.unsupportedFiles[0]}).`);
  for (const f of report.failures) lines.push(`Below threshold: ${f.metric} ${(f.ratio * 100).toFixed(1)}% < ${(f.threshold * 100).toFixed(1)}%`);
  return lines.join("\n");
}
