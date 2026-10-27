import type { Link, Note } from "@poetics/core";

/** Headings for known areas, in display order. Other areas follow alphabetically. */
export const AREA_TITLES: ReadonlyArray<readonly [string, string]> = [
  ["tooling", "Tooling"],
  ["node", "Node, type stripping and modules"],
  ["schemas", "JSON Schemas"],
  ["sqlite", "SQLite index"],
  ["store", "Store"],
  ["releases", "Releases"],
];

const KIND_LABELS: Record<Note["kind"], string> = {
  gotcha: "Gotcha",
  workaround: "Workaround",
  invariant: "Invariant",
};

export interface RenderOptions {
  /** uid → unit name, so anchors read as names rather than ULIDs. */
  unitNames?: ReadonlyMap<string, string>;
}

/**
 * Renders notes as GOTCHAS.md. Deterministic: the same notes always give the
 * same bytes, so CI can check the committed file is up to date.
 */
export function renderGotchas(notes: readonly Note[], options: RenderOptions = {}): string {
  const active = notes.filter((note) => note.status === "active");
  const retired = notes.filter((note) => note.status !== "active");
  const lines: string[] = [
    "# GOTCHAS",
    "",
    "<!-- Generated from .poetics/notes/ by `pnpm gotchas`. Do not edit by hand: add or change a note file instead (see the poetics-gotcha skill). -->",
    "",
    "Problems that cost someone time, and how to get past them. Each entry is a note in `.poetics/notes/`, anchored to the code, files, dependencies or commands it is about.",
  ];

  for (const [area, title] of orderedAreas(active)) {
    lines.push("", `## ${title}`);
    for (const note of active.filter((n) => n.area === area).sort(byId)) lines.push("", ...renderNote(note, options));
  }

  if (retired.length > 0) {
    lines.push("", "## Resolved and superseded", "", "| Note | Status |", "| --- | --- |");
    for (const note of [...retired].sort(byId)) {
      const status =
        note.status === "resolved"
          ? `Resolved by ${formatLink(note.resolvedBy!)}`
          : `Superseded by \`${note.supersededBy}\``;
      lines.push(`| ${escapeCell(note.title)} (\`${note.id}\`) | ${escapeCell(status)} |`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function renderNote(note: Note, options: RenderOptions): string[] {
  const lines = [`### ${note.title}`, ""];
  if (note.kind !== "gotcha") lines.push(`*${KIND_LABELS[note.kind]}.*`, "");
  if (note.symptoms.length > 0) lines.push(`- **Symptom:** ${note.symptoms.map(code).join("; ")}`);
  lines.push(`- **Cause:** ${note.cause}`, `- **Fix:** ${note.fix}`);

  const anchors = [
    ...(note.anchors.commands ?? []).map(code),
    ...(note.anchors.dependencies ?? []).map((dep) => code(dep.range ? `${dep.name}@${dep.range}` : dep.name)),
    ...(note.anchors.paths ?? []).map(code),
    ...(note.anchors.units ?? []).map((unit) => code(options.unitNames?.get(unit.uid) ?? unit.uid)),
  ];
  if (anchors.length > 0) lines.push(`- **Applies to:** ${anchors.join(", ")}`);
  if (note.check) {
    const name = note.check.name ? ` (${note.check.name})` : "";
    lines.push(`- **Caught by:** ${note.check.kind} ${code(note.check.ref)}${name}`);
  }
  if (note.links && note.links.length > 0) lines.push(`- **See:** ${note.links.map(formatLink).join(", ")}`);
  lines.push(`- **Note:** \`${note.id}\``);
  return lines;
}

function orderedAreas(notes: readonly Note[]): Array<readonly [string, string]> {
  const present = new Set(notes.map((note) => note.area));
  const known = AREA_TITLES.filter(([area]) => present.has(area));
  const knownIds = new Set(known.map(([area]) => area));
  const others = [...present]
    .filter((area) => !knownIds.has(area))
    .sort()
    .map((area) => [area, area.charAt(0).toUpperCase() + area.slice(1).replaceAll("-", " ")] as const);
  return [...known, ...others];
}

function byId(a: Note, b: Note): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Inline code that survives backticks in the text. */
function code(text: string): string {
  const fence = text.includes("`") ? "``" : "`";
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

function formatLink(link: Link): string {
  if (typeof link === "string") return link.startsWith("http") ? `<${link}>` : code(link);
  if (link.url) return `[${link.kind} ${link.ref}](${link.url})`;
  if (link.kind === "decision" || link.kind === "plan" || link.kind === "doc") return `[${link.ref}](${link.ref})`;
  return `${link.kind} ${code(link.ref)}`;
}

function escapeCell(text: string): string {
  return text.replaceAll("|", "\\|");
}
