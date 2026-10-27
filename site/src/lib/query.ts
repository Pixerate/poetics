// Pure helpers behind the demo's search, filters and note lookup.
import type { Link, Note } from "@poetics/core";
import type { SiteUnit } from "./types.ts";

export interface UnitFilter {
  query: string;
  area: string;
  kind: string;
}

/** Units whose name, file, docs or rationale contain every word of the query. */
export function filterUnits(units: readonly SiteUnit[], filter: UnitFilter): SiteUnit[] {
  const words = filter.query.toLowerCase().split(/\s+/).filter(Boolean);
  return units.filter((unit) => {
    if (filter.area && unit.area !== filter.area) return false;
    if (filter.kind && unit.kind !== filter.kind) return false;
    if (words.length === 0) return true;
    const haystack = [unit.name, unit.location.file, unit.docs ?? "", ...unit.versions.map((v) => v.rationale)].join(" ").toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

export interface NoteMatch {
  note: Note;
  score: number;
  reason: string;
}

/**
 * Notes matching pasted error text: a sketch of the planned poetics_notes
 * tool. Verbatim symptoms score highest, then commands and dependencies the
 * text mentions, then title words.
 */
export function matchNotes(notes: readonly Note[], text: string): NoteMatch[] {
  const haystack = text.toLowerCase().trim();
  if (!haystack) return [];
  const matches: NoteMatch[] = [];
  for (const note of notes) {
    if (note.status !== "active") continue;
    const symptom = note.symptoms.find((s) => {
      const needle = s.toLowerCase();
      return haystack.includes(needle) || (haystack.length >= 8 && needle.includes(haystack));
    });
    if (symptom) {
      matches.push({ note, score: 3, reason: `symptom “${symptom}”` });
      continue;
    }
    const command = note.anchors.commands?.find((c) => haystack.includes(c.toLowerCase()));
    if (command) {
      matches.push({ note, score: 2, reason: `command ${command}` });
      continue;
    }
    const dependency = note.anchors.dependencies?.find((d) => haystack.includes(d.name.toLowerCase()));
    if (dependency) {
      matches.push({ note, score: 2, reason: `dependency ${dependency.name}` });
      continue;
    }
    const words = haystack.split(/[^a-z0-9.:@/-]+/).filter((w) => w.length >= 4);
    const title = note.title.toLowerCase();
    const hits = words.filter((w) => title.includes(w));
    if (hits.length > 0) matches.push({ note, score: 1, reason: `title mentions ${hits.slice(0, 3).join(", ")}` });
  }
  // Title-word matches are only a fallback; they add noise next to real symptom matches.
  const best = Math.max(0, ...matches.map((m) => m.score));
  return matches
    .filter((m) => best < 2 || m.score >= 2)
    .sort((a, b) => b.score - a.score || (a.note.id < b.note.id ? -1 : 1));
}

/** Active notes anchored to a unit by uid or by its file. */
export function notesForUnit(notes: readonly Note[], unit: SiteUnit): Note[] {
  return notes.filter(
    (note) =>
      note.status === "active" &&
      ((note.anchors.units ?? []).some((a) => a.uid === unit.uid) || (note.anchors.paths ?? []).includes(unit.location.file)),
  );
}

/** Whether a note anchored to this unit was confirmed against an older version. */
export function isStaleFor(note: Note, unit: SiteUnit): boolean {
  const anchor = note.anchors.units?.find((a) => a.uid === unit.uid);
  return anchor?.observedAt !== undefined && anchor.observedAt !== unit.versions.at(-1)?.contentHash;
}

export function sourceUrl(repo: { url: string; commit: string }, file: string, line?: number): string {
  return `${repo.url}/blob/${repo.commit}/${file}${line ? `#L${line}` : ""}`;
}

/** Where a link points, or undefined when it is a plain reference. */
export function linkHref(link: Link, repo: { url: string; commit: string }): string | undefined {
  if (typeof link === "string") return /^https?:/.test(link) ? link : sourceUrl(repo, link);
  if (link.url) return link.url;
  if (link.kind === "github-issue" || link.kind === "github-pr") return `${repo.url}/issues/${link.ref.replace(/^#/, "")}`;
  if (link.kind === "commit") return `${repo.url}/commit/${link.ref}`;
  if (["decision", "plan", "doc"].includes(link.kind)) {
    const [path, anchor] = link.ref.split("#");
    return `${sourceUrl(repo, path!)}${anchor ? `#${anchor}` : ""}`;
  }
  return undefined;
}

export function linkLabel(link: Link): string {
  if (typeof link === "string") return link.replace(/^https?:\/\//, "");
  if (link.kind === "decision") return `ADR ${/(\d{4})/.exec(link.ref)?.[1] ?? link.ref}`;
  if (link.kind === "plan") return `plan §${link.ref.split("#")[1] ?? ""}`.replace(/§$/, "");
  return `${link.kind} ${link.ref}`;
}

export function percent(ratio: number): string {
  return `${Math.floor(ratio * 1000) / 10}%`;
}

export interface TextSegment {
  text: string;
  code: boolean;
}

/** Splits text on backtick pairs so `inline code` in notes and rationale renders as code. */
export function inlineCode(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  const pattern = /`([^`]+)`/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) segments.push({ text: text.slice(last, match.index), code: false });
    segments.push({ text: match[1]!, code: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last), code: false });
  return segments;
}
