import type { Note, Unit } from "@poetics/core";

export interface Ratio {
  covered: number;
  total: number;
  ratio: number;
}

export type MetricName = "tracked" | "fresh" | "linkedRationale" | "reviewed" | "tested" | "documented";

export type Metrics = Record<MetricName, Ratio>;

export interface SiteCoverage {
  overall: Metrics;
  byArea: Record<string, Metrics>;
  notes: { active: number; withCheck: number; retired: number };
  unsupportedFiles: string[];
  failures: Array<{ metric: MetricName; ratio: number; threshold: number }>;
}

/** A unit as the demo shows it: the stored record plus derived fields. */
export interface SiteUnit extends Unit {
  area: string;
  /** Current source text of the declaration, when it could be found. */
  source?: string;
  startLine?: number;
}

export interface SiteDecision {
  id: string;
  title: string;
  status: string;
  path: string;
}

/** Everything the demo renders, exported from the repository at build time. */
export interface SiteData {
  generatedAt: string;
  repo: { url: string; commit: string };
  thresholds: Partial<Record<MetricName, number>>;
  coverage: SiteCoverage;
  units: SiteUnit[];
  notes: Note[];
  decisions: SiteDecision[];
}
