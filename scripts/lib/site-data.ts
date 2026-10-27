// Shapes the repository's own .poetics/ data for the GitHub Pages demo.
import type { Note, Unit } from "@poetics/core";
import type { SiteCoverage, SiteData, SiteDecision, SiteUnit } from "../../site/src/lib/types.ts";
import { areaOf } from "./coverage.ts";
import type { Declaration } from "./declarations.ts";

export interface SiteInputs {
  repoUrl: string;
  commit: string;
  generatedAt: string;
  thresholds: SiteData["thresholds"];
  coverage: SiteCoverage;
  units: readonly Unit[];
  notes: readonly Note[];
  declarations: readonly Declaration[];
  /** Repo-relative path → file text, for the files declarations came from. */
  sources: ReadonlyMap<string, string>;
  decisions: readonly SiteDecision[];
}

export function buildSiteData(inputs: SiteInputs): SiteData {
  const byKey = new Map(inputs.declarations.map((d) => [`${d.file}#${d.name}`, d]));
  const units: SiteUnit[] = inputs.units
    .map((unit) => {
      const decl = byKey.get(`${unit.location.file}#${unit.location.export ?? unit.name}`);
      const text = decl && inputs.sources.get(decl.file);
      const site: SiteUnit = { ...unit, area: areaOf(unit.location.file) };
      if (decl && text !== undefined) {
        site.source = text.split("\n").slice(decl.startLine - 1, decl.endLine).join("\n");
        site.startLine = decl.startLine;
      }
      return site;
    })
    .sort((a, b) => a.location.file.localeCompare(b.location.file) || a.name.localeCompare(b.name));
  return {
    generatedAt: inputs.generatedAt,
    repo: { url: inputs.repoUrl, commit: inputs.commit },
    thresholds: inputs.thresholds,
    coverage: inputs.coverage,
    units,
    notes: [...inputs.notes].sort((a, b) => (a.id < b.id ? -1 : 1)),
    decisions: [...inputs.decisions].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

/** Title and status from a decision record's first heading and `- Status:` line. */
export function parseDecision(path: string, markdown: string): SiteDecision | undefined {
  const heading = /^#\s+(\d{4})\.\s+(.+)$/m.exec(markdown);
  if (!heading) return undefined;
  const status = /^-\s+Status:\s+(.+)$/m.exec(markdown)?.[1]?.trim() ?? "Unknown";
  return { id: heading[1]!, title: heading[2]!.trim(), status, path };
}
