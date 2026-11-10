// Issues and reviews for agents (docs/plan.md, "Issue trackers"): a unit's
// signals, and the units an issue likely touches. Units store references to
// issues, never their text; titles, bodies and review comments are read on
// demand through the issue tracker and handed to the agent as data.
import { isRemoved } from "@poetics/core";
import type { IssueTracker, Link, TrackedIssue, Uid, Unit } from "@poetics/core";
import type { CodeView } from "./code.ts";

/** The issue tracker for a tool call, or why there is none. */
export interface TrackerAccess {
  tracker?: IssueTracker;
  /** `owner/name`, to check references that name a repository. */
  repo?: string;
  /** Why there is no tracker, said under `missing`. */
  unavailable?: string;
}

/** An issue reference as an agent passes it: `#12`, `12`, `owner/name#12`, or a GitHub issue or pull request URL. */
export function parseIssueRef(ref: string, repo?: string): number {
  const text = ref.trim();
  const bare = /^#?(\d+)$/.exec(text);
  if (bare) return Number(bare[1]);
  const named = /^([\w.-]+\/[\w.-]+)#(\d+)$/.exec(text) ?? /^https?:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/(?:issues|pull)\/(\d+)\b/.exec(text);
  if (!named) throw new Error(`Not an issue reference: ${ref}. Pass #12, owner/name#12 or an issue URL`);
  if (repo && named[1]!.toLowerCase() !== repo.toLowerCase()) throw new Error(`${ref} is in ${named[1]}, not this repository (${repo})`);
  return Number(named[2]);
}

type LinkedKind = "issue" | "pull-request";

/** A version's link to an issue or pull request in this repository, by number. */
export function linkedNumber(link: Link): { kind: LinkedKind; number: number } | undefined {
  if (typeof link === "string") return undefined;
  const kind = link.kind === "github-issue" ? "issue" : link.kind === "github-pr" || link.kind === "github-pull-request" ? "pull-request" : undefined;
  const number = /^#?(\d+)$/.exec(link.ref)?.[1];
  return kind && number ? { kind, number: Number(number) } : undefined;
}

/** Where a signal was linked from. */
export interface SignalVersion {
  contentHash: string;
  change: string;
  commit?: string;
  /** From `prehistory`: inferred by backfill, not recorded as the code changed. */
  prehistory?: true;
}

/** An issue or pull request linked from a unit's versions, with what the tracker says about it. */
export interface LinkedSignal {
  ref: string;
  kind: LinkedKind;
  url?: string;
  title?: string;
  state?: TrackedIssue["state"];
  labels?: string[];
  /** The versions that link it, newest first. */
  versions: SignalVersion[];
}

/** A review comment left in a linked pull request on the unit's file. */
export interface ReviewSignal {
  pullRequest: string;
  path: string;
  /** As the pull request saw the file, which may differ from the file now. */
  startLine: number;
  endLine: number;
  body: string;
}

export interface SignalsReport {
  uid: Uid;
  name: string;
  /** Newest first, by the newest version that links each. */
  linked: LinkedSignal[];
  reviewComments: ReviewSignal[];
  /** Production errors resolved to this unit's versions. */
  errors: never[];
  /** What the report cannot show, and why. */
  missing: string[];
}

const MAX_REVIEW_COMMENTS = 20;
const MAX_COMMENT_CHARS = 1000;

/** The issues and pull requests a unit's versions link, newest first, each once. */
export function linkedSignals(unit: Unit): LinkedSignal[] {
  const found = new Map<string, LinkedSignal>();
  const versions = [...(unit.prehistory ?? []).map((version) => ({ version, prehistory: true as const })), ...unit.versions.map((version) => ({ version, prehistory: undefined }))].reverse();
  for (const { version, prehistory } of versions) {
    for (const link of version.links ?? []) {
      const linked = linkedNumber(link);
      if (!linked) continue;
      const key = `${linked.kind}#${linked.number}`;
      const signal = found.get(key) ?? { ref: `#${linked.number}`, kind: linked.kind, versions: [] };
      // A link may be repeated on one version; list the version once.
      if (!signal.versions.some((v) => v.contentHash === version.contentHash)) {
        signal.versions.push({ contentHash: version.contentHash, change: version.change, ...(version.commit ? { commit: version.commit } : {}), ...(prehistory ? { prehistory } : {}) });
      }
      found.set(key, signal);
    }
  }
  return [...found.values()];
}

/**
 * A unit's signals: the issues and pull requests its versions link, with
 * titles and states from the tracker, and review comments those pull requests
 * left on its file. Production errors need an error-monitoring integration,
 * so they are listed as missing.
 */
export async function unitSignals(unit: Unit, access: TrackerAccess): Promise<SignalsReport> {
  const report: SignalsReport = { uid: unit.uid, name: unit.name, linked: linkedSignals(unit), reviewComments: [], errors: [], missing: [] };
  const { tracker } = access;
  if (!tracker?.issue) {
    if (report.linked.length > 0) report.missing.push(`titles, states and review comments: ${access.unavailable ?? "the issue tracker cannot read issues"}`);
  } else {
    try {
      for (const signal of report.linked) {
        const number = Number(signal.ref.slice(1));
        const issue = await tracker.issue(number);
        if (!issue) continue;
        Object.assign(signal, { url: issue.url, title: issue.title, state: issue.state, labels: issue.labels });
        // GitHub numbers issues and pull requests together, so a link's kind is a guess the tracker settles.
        if (issue.pullRequest) signal.kind = "pull-request";
      }
      // Review comments are tied to lines as the pull request saw them; lines move, files rarely do.
      for (const signal of report.linked.filter((s) => s.kind === "pull-request")) {
        for (const comment of await tracker.reviewComments(Number(signal.ref.slice(1)))) {
          if (comment.path !== unit.location.file) continue;
          report.reviewComments.push({ pullRequest: signal.ref, path: comment.path, startLine: comment.startLine, endLine: comment.endLine, body: clip(comment.body, MAX_COMMENT_CHARS) });
        }
      }
    } catch (error) {
      report.missing.push(`some titles and review comments: ${(error as Error).message}`);
    }
    if (report.reviewComments.length > MAX_REVIEW_COMMENTS) {
      report.missing.push(`${report.reviewComments.length - MAX_REVIEW_COMMENTS} more review comments`);
      report.reviewComments.length = MAX_REVIEW_COMMENTS;
    }
  }
  report.missing.push("production errors: no error-monitoring integration yet");
  return report;
}

/** Why an issue points at a unit, strongest first. */
export type IssueMatch = "linked" | "stack" | "name" | "path" | "search";

const WEIGHT: Record<IssueMatch, number> = { linked: 8, stack: 6, name: 3, path: 2, search: 1 };

export interface IssueCandidate {
  uid: Uid;
  why: IssueMatch[];
  score: number;
}

const SOURCE_FILE = /[\w@./-]*[\w-]+\.(?:tsx?|mts|cts|jsx?|mjs|cjs|svelte)\b/g;

/**
 * The units an issue likely touches, best first: units whose versions already
 * link it, units a stack frame in it falls inside, units it names as code,
 * units in files it mentions, and units `search` finds from its title.
 */
export function unitsForIssue(
  issue: { number: number; title: string; body: string } | { number: number },
  units: readonly Unit[],
  options: { search?: (query: string) => Uid[]; view?: CodeView } = {},
): IssueCandidate[] {
  const text = "title" in issue ? `${issue.title}\n\n${issue.body}` : "";
  const reasons = new Map<Uid, Set<IssueMatch>>();
  const add = (uid: Uid, why: IssueMatch) => reasons.set(uid, (reasons.get(uid) ?? new Set()).add(why));
  const live = units.filter((unit) => !isRemoved(unit) && unit.owner === undefined);

  for (const unit of live) {
    const versions = [...(unit.prehistory ?? []), ...unit.versions];
    if (versions.some((version) => (version.links ?? []).some((link) => linkedNumber(link)?.number === issue.number))) add(unit.uid, "linked");
  }
  if (text) {
    const files = [...new Set(text.match(SOURCE_FILE) ?? [])];
    const frames = [...text.matchAll(/([\w@./-]*[\w-]+\.(?:tsx?|mts|cts|jsx?|mjs|cjs|svelte)):(\d+)/g)].map((m) => ({ file: m[1]!, line: Number(m[2]) }));
    const backticked = new Set([...text.matchAll(/`([^`\n]+)`/g)].flatMap((m) => m[1]!.match(/[A-Za-z_$][\w$]*/g) ?? []));
    const words = new Set(text.match(/[A-Za-z_$][\w$]*/g) ?? []);
    for (const unit of live) {
      const file = unit.location.file;
      if (files.some((mention) => samePath(mention, file))) add(unit.uid, "path");
      const code = options.view?.byUid.get(unit.uid);
      if (code && frames.some((frame) => samePath(frame.file, file) && within(options.view!.linesOf(code), frame.line))) add(unit.uid, "stack");
      // Prose is full of short common words; a name counts when it is quoted as code or looks like code.
      if (backticked.has(unit.name) || (words.has(unit.name) && looksLikeCode(unit.name))) add(unit.uid, "name");
    }
    const liveIds = new Set(live.map((unit) => unit.uid));
    for (const uid of (options.search?.("title" in issue ? issue.title : "") ?? []).slice(0, 5)) if (liveIds.has(uid)) add(uid, "search");
  }

  const order = Object.keys(WEIGHT) as IssueMatch[];
  return [...reasons]
    .map(([uid, why]) => {
      const sorted = order.filter((reason) => why.has(reason));
      return { uid, why: sorted, score: sorted.reduce((sum, reason) => sum + WEIGHT[reason], 0) };
    })
    .sort((a, b) => b.score - a.score || a.uid.localeCompare(b.uid));
}

/** Issues linked from these units other than `except`, each with the units that link it. */
export function relatedIssues(units: readonly Unit[], except: number): Array<{ ref: string; units: string[] }> {
  const related = new Map<string, Set<string>>();
  for (const unit of units) {
    for (const signal of linkedSignals(unit)) {
      if (signal.kind !== "issue" || signal.ref === `#${except}`) continue;
      related.set(signal.ref, (related.get(signal.ref) ?? new Set()).add(unit.name));
    }
  }
  return [...related].map(([ref, names]) => ({ ref, units: [...names].sort() })).sort((a, b) => Number(b.ref.slice(1)) - Number(a.ref.slice(1)));
}

/** A mention and a repository path name the same file: equal, or one ends with the other at a directory boundary. */
function samePath(mention: string, file: string): boolean {
  const m = mention.replace(/^(?:webpack:\/\/\/?|file:\/\/)/, "").replace(/^\.\//, "");
  return m === file || m.endsWith(`/${file}`) || (m.includes("/") && file.endsWith(`/${m}`));
}

function within(lines: { startLine: number; endLine: number }, line: number): boolean {
  return line >= lines.startLine && line <= lines.endLine;
}

/** camelCase, PascalCase with a second capital, or with a digit, underscore or `$`. */
function looksLikeCode(name: string): boolean {
  return /[a-z][A-Z]|[A-Z].*[A-Z]|[\d_$]/.test(name);
}

function clip(text: string, chars: number): string {
  return text.length > chars ? `${text.slice(0, chars - 1)}…` : text;
}
