// poetics backfill --snapshot (ADR 0011): a unit file for every export that has
// none, with a rationale extracted from evidence already in the repository and
// an `inferred` record saying how sure it is. Units that have a file are never
// written to; what they lack is listed for someone to add.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { contentTree, createTypeScriptIndexer, fingerprint, signatureText } from "@poetics/adapter-typescript";
import { detectIn } from "./declarations.ts";
import type { FrameworkPlugin, IndexedUnit } from "@poetics/adapter-typescript";
import { REMOVED_CONTENT_HASH, contentHash, isRemoved, matchIdentities, mintUid } from "@poetics/core";
import type { Actor, ChangeClass, CodeUnit, Framework, Hash, Inferred, IssueTracker, Link, Unit, Version } from "@poetics/core";
import { appendVersion, createMatcher, createUnit, extendsPrehistory, filesInScope, isParseable, parseUnit, readUnitFiles, setPrehistory, storePaths } from "@poetics/store";
import type { PoeticsConfig, StoreLayout } from "@poetics/store";
import { git, showAt } from "./git.ts";
import type { TrackerStatus } from "./github.ts";
import { pullRequestEvidence, pullRequestTexts, pullRequestsInSubject, trackerReader, withPullRequests } from "./pull-requests.ts";
import { draftRequest, draftVersions, formatDraftReport } from "./draft.ts";
import type { DraftReport, DraftRequest, Drafter } from "./draft.ts";
import type { CommitPullRequests, TrackerUse } from "./pull-requests.ts";
import { pluginsFor } from "./frameworks.ts";
import { planIndex } from "./indexing.ts";

/** One piece of evidence about why a unit exists. */
export interface Evidence {
  source: Inferred["sources"][number];
  /** Where it came from: a commit, a file, a path. */
  ref: string;
  text?: string;
}

export interface BackfillPlan {
  /** New units, each with its inferred rationale, ready to write. */
  created: Array<{ unit: Unit; evidence: Evidence[] }>;
  byConfidence: Record<Inferred["confidence"], number>;
  /** Existing units with code changes nobody recorded: `poetics index` is the tool for those. */
  unrecorded: number;
  /** Existing units the code has TSDoc or a sibling test for that the unit file lacks. */
  missingDocs: Array<{ uid: string; name: string; file: string }>;
  missingTests: Array<{ uid: string; name: string; file: string; test: string }>;
  /** Comments that read like a workaround or an invariant: candidates for a note, never written. */
  candidateNotes: Array<{ file: string; line: number; text: string }>;
  /** The issue tracker's part: used, or why its collectors were skipped. */
  tracker?: TrackerUse;
  /** With `--draft`: what the drafter did. */
  draft?: DraftReport;
}

/** Where pull request evidence comes from: a tracker when one is connected, and why not when it is not. */
export interface TrackerOptions {
  tracker?: IssueTracker;
  /** `used` with a tracker; otherwise the reason there is none, for the report. */
  trackerStatus?: TrackerStatus;
}

/** `--draft`: who drafts rationale, and whether a private repository's pull request text may reach it (ADR 0011, ADR 0017). */
export interface DraftOptions {
  drafter?: Drafter;
  /** `--draft-private`: send pull request and review text even when the repository is not public. It is never quoted. */
  draftPrivate?: boolean;
  /** Where drafts are cached between runs. */
  draftCache?: string;
}

const BY = "poetics-backfill";
const NOTE_COMMENT = /\/\/\s*(.*\b(?:HACK|XXX|workaround|work around|do not|don't|never|must)\b.*)$/i;
const AGENT_TRAILER = /\b(claude|copilot|codex|gemini|cursor|devin|aider|chatgpt)\b/i;

/** What a snapshot backfill would write. Nothing is written until `applyBackfill`. */
export async function planBackfill(root: string, config: PoeticsConfig, options: TrackerOptions & DraftOptions = {}): Promise<BackfillPlan> {
  const pulls = trackerReader(options.tracker, options.trackerStatus);
  const prText = await pullRequestTextAllowed(options);
  const jobs: Array<{ version: Version; request: DraftRequest }> = [];
  const index = await planIndex(root, config, { rationale: "backfill" });
  // The same index planIndex just built, from its cache: spans for blame, docs for the gaps.
  const { parseable } = await filesInScope(root, config);
  const tsconfig = config.typescript?.tsconfig;
  const code = createTypeScriptIndexer({ root, files: parseable, cacheFile: join(storePaths(root).cache, "typescript.json"), plugins: pluginsFor(config), ...(tsconfig ? { tsconfig } : {}) }).index().units;
  const place = (file: string, name: string, kind: string) => `${file}#${name}#${kind === "type"}`;
  const codeAt = new Map(code.map((unit) => [place(unit.span.file, unit.name, unit.kind), unit]));
  const blame = blameLines(root);
  const commits = commitReader(root);

  // How many new units each commit introduced: text shared by many units speaks to none of them in particular.
  const introducedBy = new Map<string, string | undefined>();
  for (const unit of index.created) {
    const at = codeAt.get(place(unit.location.file, unit.name, unit.kind));
    // The declaration's first line: the commit that wrote the unit's header as it stands.
    introducedBy.set(unit.uid, at ? blame(unit.location.file, at.startLine) : undefined);
  }
  const perCommit = new Map<string, number>();
  for (const sha of introducedBy.values()) if (sha) perCommit.set(sha, (perCommit.get(sha) ?? 0) + 1);
  // Whether a commit is about one unit: it introduced one export when it was made, not just one that survives, since
  // an "initial commit" whose other exports were deleted since still described all of them (ADR 0022). Read only when
  // it decides confidence, and only as far as a second export.
  const plugins = pluginsFor(config);
  const inScope = createMatcher(config.include, config.exclude ?? []);
  const indexable = (file: string) => inScope(file) && isParseable(file, config.adapters);
  const aboutOne = new Map<string, boolean>();
  const aboutOneUnit = (sha: string) => {
    if (perCommit.get(sha) !== 1) return false;
    if (!aboutOne.has(sha)) aboutOne.set(sha, exportsIntroduced(root, sha, indexable, plugins, 2) <= 1);
    return aboutOne.get(sha)!;
  };

  const plan: BackfillPlan = {
    created: [],
    byConfidence: { high: 0, medium: 0, low: 0 },
    unrecorded: new Set([...index.versions, ...index.moves, ...index.removed].map((entry) => entry.uid)).size,
    missingDocs: [],
    missingTests: [],
    candidateNotes: [],
  };
  const docsMentioning = docMentions(root);
  const changesets = changesetReader(root);

  for (const unit of index.created) {
    const sha = introducedBy.get(unit.uid);
    const commit = sha ? commits(sha) : undefined;
    const evidence: Evidence[] = [];
    const links: Link[] = [];
    let rationale: string | undefined;
    let confidence: Inferred["confidence"] = "low";
    let found: CommitPullRequests | undefined;

    const changeset = commit ? changesets(commit.sha, packageOf(root, unit.location.file)) : undefined;
    if (changeset) {
      evidence.push({ source: "changeset", ref: changeset.path, text: changeset.text });
      links.push({ kind: "changeset", ref: changeset.path });
      rationale = changeset.text;
    }
    if (commit) {
      evidence.push({ source: "commit", ref: commit.sha, ...(commit.body || commit.subject ? { text: commit.body || commit.subject } : {}) });
      for (const issue of commit.issues) links.push({ kind: "github-issue", ref: issue });
      if (!rationale && (commit.body || commit.subject)) rationale = commit.body || commit.subject;
      // A changeset or commit describes the whole change even when it names this unit (ADR 0018): it speaks to this
      // unit alone only when the change introduced nothing else, or alongside the unit's own doc comment.
      if (rationale) confidence = confidenceOf({ reason: true, specific: Boolean(unit.docs) || aboutOneUnit(commit.sha) });
      // Pull requests are linked and can raise confidence; their text never becomes the rationale.
      const at = codeAt.get(place(unit.location.file, unit.name, unit.kind));
      found = await pulls.read(commit.sha);
      const prs = pullRequestEvidence(commit.rawSubject, found, { name: unit.name, file: unit.location.file, startLine: at?.startLine ?? 0, endLine: at?.endLine ?? 0 });
      links.push(...prs.links);
      for (const source of prs.sources) evidence.push({ source, ref: commit.sha });
      confidence = withPullRequests(confidence, found, prs.speaks);
    }
    if (unit.docs) {
      evidence.push({ source: "comment", ref: unit.location.file, text: unit.docs });
      // The unit's own doc comment says what it is for and the change's text why it was added, so the comment leads
      // (ADR 0019). It leads a one-unit commit's text too, which is often a few words (ADR 0022).
      rationale = rationale ? `${unit.docs}\n\n${rationale}` : unit.docs;
    }
    for (const test of unit.tests ?? []) evidence.push({ source: "test", ref: test.file });
    for (const doc of docsMentioning(unit.name)) {
      evidence.push({ source: "doc", ref: doc });
      links.push({ kind: "doc", ref: doc });
    }

    const version = unit.versions[0]!;
    version.rationale = rationale ?? `Present in ${unit.location.file} when Poetics was adopted; nothing in the repository says why.`;
    if (links.length > 0) version.links = dedupe(links);
    if (commit) version.commit = commit.sha;
    version.actor = commit?.agent ? { kind: "agent", tool: commit.agent, reviewed: false } : { kind: "human" };
    version.inferred = { by: BY, confidence, sources: [...new Set(evidence.map((e) => e.source))], drafted: false, reviewed: false };
    if (options.drafter) {
      const at = codeAt.get(place(unit.location.file, unit.name, unit.kind));
      const lines = { name: unit.name, file: unit.location.file, startLine: at?.startLine ?? 0, endLine: at?.endLine ?? 0 };
      jobs.push({
        version,
        request: draftRequest({
          unit: { name: unit.name, kind: unit.kind, file: unit.location.file },
          change: "created",
          ...(commit ? { commit: commit.sha } : {}),
          code: at ? readFileSync(join(root, unit.location.file), "utf8").slice(at.span.start, at.span.end) : "",
          evidence: [
            ...evidence.filter((e) => e.text).map((e) => ({ source: e.source, ref: e.ref, text: e.text!, quotable: true })),
            ...(prText ? pullRequestTexts(found, lines) : []),
          ],
        }),
      });
    }
    plan.created.push({ unit, evidence });
  }
  if (options.drafter) plan.draft = await draftVersions(jobs, options.drafter, options.draftCache ? { cacheFile: options.draftCache } : {});
  // Counted after drafting, which lowers a version drafted from the diff alone.
  for (const { unit } of plan.created) plan.byConfidence[unit.versions[0]!.inferred!.confidence]++;

  const existing = (await readUnitFiles(storePaths(root))).map(parseUnit).filter((unit) => !isRemoved(unit));
  listGaps(root, parseable, existing, codeAt, plan);
  const tracker = pulls.use();
  if (tracker) plan.tracker = tracker;
  return plan;
}

/** Writes the planned units, each as the actor its evidence names. Returns how many were written. */
export async function applyBackfill(root: string, plan: BackfillPlan, layout: StoreLayout = "flat"): Promise<number> {
  for (const { unit } of plan.created) {
    await createUnit({ paths: storePaths(root), actor: unit.versions[0]!.actor as Actor }, unit, layout);
  }
  return plan.created.length;
}

/** The report for people: confidence counts, then what to add or record by hand. */
export function formatBackfillPlan(plan: BackfillPlan, written?: number): string {
  const lines: string[] = [];
  for (const { unit } of plan.created) {
    const version = unit.versions[0]!;
    lines.push(`+ ${unit.location.file}#${unit.name} [${version.inferred!.confidence}] ${firstLine(version.rationale)}`);
  }
  for (const gap of plan.missingDocs) lines.push(`docs? ${gap.file}#${gap.name} has TSDoc its unit file lacks`);
  for (const gap of plan.missingTests) lines.push(`tests? ${gap.file}#${gap.name} looks tested by ${gap.test}`);
  for (const note of plan.candidateNotes) lines.push(`note? ${note.file}:${note.line} ${note.text}`);
  if (plan.unrecorded > 0) lines.push(`${plan.unrecorded} existing unit(s) have unrecorded changes; poetics index records those.`);
  if (plan.tracker) lines.push(trackerLine(plan.tracker));
  if (plan.draft) lines.push(...formatDraftReport(plan.draft));
  const { high, medium, low } = plan.byConfidence;
  const counts = `${plan.created.length} new unit(s) (${high} high, ${medium} medium, ${low} low confidence)`;
  lines.push(written === undefined ? `Would create ${counts}. Run with --write to write them.` : `Created ${counts}.`);
  return lines.join("\n");
}

/** Whether there is anything to write. */
export function hasBackfill(plan: BackfillPlan): boolean {
  return plan.created.length > 0;
}

// Docs, tests and candidate notes for units that already have a file: listed, never written.
function listGaps(root: string, parseable: readonly string[], existing: readonly Unit[], codeAt: ReadonlyMap<string, IndexedUnit>, plan: BackfillPlan): void {
  for (const unit of existing) {
    const at = codeAt.get(`${unit.location.file}#${unit.name}#${unit.kind === "type"}`);
    if (!at) continue;
    if (!unit.docs && at.docs) plan.missingDocs.push({ uid: unit.uid, name: unit.name, file: unit.location.file });
    const test = siblingTest(root, unit.location.file, unit.name);
    if (test && !(unit.tests ?? []).some((t) => t.file === test)) plan.missingTests.push({ uid: unit.uid, name: unit.name, file: unit.location.file, test });
  }
  for (const file of parseable) {
    readFileSync(join(root, file), "utf8")
      .split("\n")
      .forEach((line, i) => {
        const match = NOTE_COMMENT.exec(line);
        if (match) plan.candidateNotes.push({ file, line: i + 1, text: match[1]!.trim() });
      });
  }
}

/** Line-by-line authorship from `git blame`, one run per file; undefined for uncommitted lines or untracked files. */
/**
 * How many exports a commit added to the files in scope, counting ones deleted since: each file it added, changed
 * or renamed is read as the commit left it and as its parent had it (under its old name, for a rename), and an export
 * is new when the parent's file had none of that name and kind. A root commit's every export is new. Counting stops
 * at `atMost`.
 */
export function exportsIntroduced(root: string, sha: string, indexable: (file: string) => boolean, plugins: readonly FrameworkPlugin[] = [], atMost = Infinity): number {
  const parent = git(root, ["rev-list", "--parents", "-n", "1", sha]).trim().split(" ")[1];
  const changes = git(root, ["diff-tree", "--no-commit-id", "--name-status", "-r", "-M", "--root", sha]).split("\n").filter(Boolean);
  const names = (file: string, text: string | undefined) => new Set(text === undefined ? [] : detectIn(file, text, plugins).units.map((unit) => `${unit.name}#${unit.kind === "type"}`));
  let added = 0;
  for (const line of changes) {
    const [status = "", first = "", second] = line.split("\t");
    if (status.startsWith("D")) continue;
    const file = second ?? first;
    if (!indexable(file)) continue;
    const before = names(first, parent ? showAt(root, parent, first) : undefined);
    for (const name of names(file, showAt(root, sha, file))) if (!before.has(name) && ++added >= atMost) return added;
  }
  return added;
}

function blameLines(root: string): (file: string, line: number) => string | undefined {
  const files = new Map<string, string[]>();
  return (file, line) => {
    if (!files.has(file)) {
      const shas: string[] = [];
      try {
        // Porcelain gives every line's full hash and final line number; `-l` shortens boundary commits to 39 characters.
        for (const row of git(root, ["blame", "--porcelain", "--", file]).split("\n")) {
          const header = /^([0-9a-f]{40}) \d+ (\d+)/.exec(row);
          if (header) shas[Number(header[2]) - 1] = header[1]!;
        }
      } catch {
        // Untracked, or no commits yet: nothing to attribute.
      }
      files.set(file, shas);
    }
    const sha = files.get(file)![line - 1];
    return sha && !/^0+$/.test(sha) ? sha : undefined;
  };
}

interface CommitInfo {
  sha: string;
  /** Without its Conventional Commit prefix. */
  subject: string;
  /** As written, which names a merged or squashed pull request. */
  rawSubject: string;
  body: string;
  issues: string[];
  /** The agent a `Co-Authored-By` trailer names, by its display name only. */
  agent?: string;
}

function commitReader(root: string): (sha: string) => CommitInfo {
  const cache = new Map<string, CommitInfo>();
  return (sha) => {
    if (!cache.has(sha)) {
      const [subject = "", raw = ""] = git(root, ["show", "-s", "--format=%s%x00%b", sha]).split("\0");
      const trailers = raw.split("\n").filter((line) => /^[A-Za-z-]+: .+/.test(line.trim()));
      const body = raw
        .split("\n")
        .filter((line) => !trailers.includes(line))
        .join("\n")
        .split(/\n\s*\n/)[0]!
        .replace(/\s+/g, " ")
        .trim();
      const agentTrailer = trailers.find((line) => /^co-authored-by:/i.test(line) && AGENT_TRAILER.test(line));
      const info: CommitInfo = {
        sha,
        // The Conventional Commit prefix says what kind of change, not why.
        subject: subject.replace(/^[a-z]+(\([^)]*\))?!?:\s*/, "").trim(),
        body,
        rawSubject: subject,
        // A merge or squash subject's number is the pull request, linked as one, not an issue.
        issues: [...new Set([...`${subject}\n${raw}`.matchAll(/(?:^|[\s(])#(\d+)\b/g)].map((m) => `#${m[1]}`))].filter((ref) => !pullRequestsInSubject(subject).includes(ref)),
      };
      const agent = agentTrailer?.replace(/^co-authored-by:\s*/i, "").replace(/\s*<[^>]*>\s*$/, "").trim();
      if (agent) info.agent = agent;
      cache.set(sha, info);
    }
    return cache.get(sha)!;
  };
}

/**
 * The changesets each commit added, read once per commit since many units share
 * one. A changeset naming the unit's package is the most specific "why" the
 * repository keeps.
 */
function changesetReader(root: string): (sha: string, pkg: string | undefined) => { path: string; text: string } | undefined {
  const byCommit = new Map<string, Array<{ path: string; front: string; text: string }>>();
  return (sha, pkg) => {
    if (!pkg) return undefined;
    if (!byCommit.has(sha)) {
      const added = git(root, ["show", "--name-only", "--diff-filter=A", "--format=", sha]).split("\n").filter((f) => /^\.changeset\/[^/]+\.md$/.test(f));
      byCommit.set(
        sha,
        added.flatMap((path) => {
          const [, front = "", body = ""] = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(showAt(root, sha, path) ?? "") ?? [];
          return front ? [{ path, front, text: body.trim().split(/\n\s*\n/)[0]!.replace(/\s+/g, " ") }] : [];
        }),
      );
    }
    const found = byCommit.get(sha)!.find(({ front }) => front.includes(`"${pkg}"`) || front.includes(`'${pkg}'`) || new RegExp(`^${pkg}:`, "m").test(front));
    return found && { path: found.path, text: found.text };
  };
}

/** The name in the nearest package.json above `file`. */
function packageOf(root: string, file: string): string | undefined {
  for (let dir = dirname(file); ; dir = dirname(dir)) {
    const path = join(root, dir, "package.json");
    if (existsSync(path)) return (JSON.parse(readFileSync(path, "utf8")) as { name?: string }).name;
    if (dir === "." || dir === "/" || dir === "") return undefined;
  }
}

/** Markdown files under docs/ and READMEs that mention a name in code style, indexed once by name. */
function docMentions(root: string): (name: string) => string[] {
  let byName: Map<string, string[]> | undefined;
  return (name) => {
    if (!byName) {
      byName = new Map();
      const docs = git(root, ["ls-files", "--", "*.md"])
        .split("\n")
        .filter((path) => path && (path.startsWith("docs/") || /(^|\/)README\.md$/.test(path)));
      for (const path of docs) {
        for (const [, code] of readFileSync(join(root, path), "utf8").matchAll(/`([^`\n]+)`/g)) {
          const paths = byName.get(code!) ?? [];
          if (!paths.includes(path)) byName.set(code!, [...paths, path]);
        }
      }
    }
    return byName.get(name) ?? [];
  };
}

function siblingTest(root: string, file: string, name: string): string | undefined {
  const test = file.replace(/\.(tsx?|mts|cts)$/, ".test.$1");
  if (test === file || !existsSync(join(root, test))) return undefined;
  return readFileSync(join(root, test), "utf8").includes(name) ? test : undefined;
}

/** Whether the repository has a first commit, so there is history to walk. */
function hasCommits(root: string): boolean {
  try {
    git(root, ["rev-parse", "--verify", "--quiet", "HEAD"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Confidence from how specifically the evidence speaks to one unit (ADR 0018): `high` when a reason comes with
 * evidence about this unit alone, `medium` when the reason is shared with other units, even one that names this
 * unit, and `low` with no reason at all.
 */
export function confidenceOf(evidence: { reason: boolean; specific: boolean }): Inferred["confidence"] {
  if (!evidence.reason) return "low";
  return evidence.specific ? "high" : "medium";
}

function dedupe(links: Link[]): Link[] {
  const seen = new Set<string>();
  return links.filter((link) => {
    const key = typeof link === "string" ? link : `${link.kind}:${link.ref}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function firstLine(text: string): string {
  const line = text.split("\n")[0]!;
  return line.length > 100 ? `${line.slice(0, 99)}…` : line;
}


/** A unit's reconstructed history, or why it stops short. */
export interface PrehistoryEntry {
  uid: string;
  name: string;
  file: string;
  prehistory: Version[];
  /** Where matching would only queue the unit: its history before this commit is not claimed. */
  stoppedAt?: { commit: string; reason: string };
}

export interface PrehistoryPlan {
  /** First-parent commits walked, oldest first. */
  commits: number;
  /** The range walked, as full commit ids: after `from` (the root when unset) up to and including `to`. */
  range: { from?: string; to: string };
  units: PrehistoryEntry[];
  /** Units first recorded after `to`: left for a walk that reaches them, since prehistory can only be extended further back. */
  beyond: number;
  /** With `includeRemoved`: exports deleted before anyone recorded them, as new unit files ending in `removed`. */
  removed: Unit[];
  /** Units whose recorded prehistory this walk would not keep as its tail (other evidence, such as pull requests): left as recorded. */
  kept: number;
  /** The issue tracker's part: used, or why its collectors were skipped. */
  tracker?: TrackerUse;
  /** With `--draft`: what the drafter did. */
  draft?: DraftReport;
}

/** Where `poetics backfill --history [from] [to]` walks (refs or commit ids, both optional), and whether to recover deleted exports. */
export interface PrehistoryRange {
  from?: string;
  to?: string;
  /** `--include-removed`: recover exports deleted before they were recorded (ADR 0011). */
  includeRemoved?: boolean;
}

interface Followed {
  code: CodeUnit;
  framework: Framework;
  /** Its source text at this point in the walk, for drafting. */
  text: string;
  runtimeHash: Hash;
  signature: string;
  history: Version[];
  stoppedAt?: { commit: string; reason: string };
  /** Its unit file is committed: from here on `poetics index` records what happens to it, removal included. */
  recorded?: boolean;
}

/**
 * `poetics backfill --history` (ADR 0011): walks the first-parent history,
 * reads each changed file's units syntactically, and follows them from commit
 * to commit with `matchIdentities`, recording a version whenever a unit's code
 * changed. A unit's prehistory is what happened before the commit that first
 * recorded its unit file. Where matching would only queue a unit, its history
 * restarts there, and the plan says so: history is never guessed.
 *
 * `range` limits the walk to the first-parent commits after `from` up to `to`
 * (default: the root to HEAD). Code that exists at `from` starts there: its
 * first change in the range opens its prehistory, which a later walk from
 * further back extends. Units first recorded after `to` are left out, since
 * prehistory that stops short of their recording could never be filled in.
 */
export async function planPrehistory(root: string, config: PoeticsConfig, range: PrehistoryRange & TrackerOptions & DraftOptions = {}): Promise<PrehistoryPlan> {
  const prText = await pullRequestTextAllowed(range);
  // Each reconstructed version's draft request, built while the walk still has the code before and after.
  const requests = new Map<Version, DraftRequest>();
  const plugins = pluginsFor(config);
  const inScope = createMatcher(config.include, config.exclude ?? []);
  const indexable = (file: string) => inScope(file) && isParseable(file, config.adapters);
  const empty = !hasCommits(root);
  if (empty && (range.from || range.to)) throw new Error("The repository has no commits to walk a range of");
  const head = empty ? "" : resolveCommit(root, "HEAD");
  const to = range.to ? resolveCommit(root, range.to) : head;
  const from = range.from ? resolveCommit(root, range.from) : undefined;
  const line = empty ? [] : git(root, ["rev-list", "--first-parent", "--reverse", to]).split("\n").filter(Boolean);
  if (from && !line.includes(from)) throw new Error(`${range.from} is not on the first-parent line of ${range.to ?? "HEAD"}, so there is no range between them`);
  const commits = from ? line.slice(line.indexOf(from) + 1) : line;
  const read = commitReader(root);
  const all = (await readUnitFiles(storePaths(root))).map(parseUnit);
  const store = new Map(all.filter((unit) => !isRemoved(unit)).map((unit) => [unit.uid, unit]));
  // A deletion already recovered, by where the code was and the commit that deleted it, so a rerun mints nothing new.
  const deletion = (file: string, name: string, commit: string) => `${file}#${name}@${commit}`;
  const recovered = new Set(all.filter(isRemoved).map((unit) => deletion(unit.location.file, unit.name, unit.versions.at(-1)!.commit ?? "")));
  const state = new Map<string, Followed[]>();
  const plan: PrehistoryPlan = { commits: commits.length, range: { ...(from ? { from } : {}), to }, units: [], beyond: 0, removed: [], kept: 0 };
  // Asked before the walk, which reads each commit synchronously: one call per commit, cached between runs.
  const pulls = trackerReader(range.tracker, range.trackerStatus);
  const pullsAt = new Map<string, CommitPullRequests | undefined>();
  for (const sha of commits) pullsAt.set(sha, await pulls.read(sha));
  const done = new Set<string>();
  const startsAt = from ? `the range starts after ${from.slice(0, 7)}; earlier history was not walked` : undefined;

  if (from) {
    // Units recorded by `from` have their prehistory before the range; none of it is here.
    for (const path of git(root, ["ls-tree", "-r", "--name-only", from, "--", ".poetics/units"]).split("\n")) {
      const recorded = /([0-9A-Z]{26})\.json$/.exec(path);
      if (recorded) done.add(recorded[1]!);
    }
    // The code at `from` is where the walk starts: followed, with no history it can claim.
    for (const file of git(root, ["ls-tree", "-r", "--name-only", from]).split("\n").filter(indexable)) {
      const text = showAt(root, from, file);
      if (text === undefined) continue;
      const { units, source } = detectIn(file, text, plugins);
      state.set(
        file,
        units.map((unit) => {
          const tree = contentTree(unit);
          return {
            code: { key: unit.key, file, name: unit.name, kind: unit.kind, contentHash: contentHash(tree), fingerprint: fingerprint(tree) },
            framework: unit.framework,
            text: text.slice(unit.span.start, unit.span.end),
            runtimeHash: contentHash(contentTree(unit, true)),
            signature: signatureText(unit, source, plugins),
            history: [],
          };
        }),
      );
    }
  }

  // A unit's prehistory is the history at its place just before its unit file was first committed.
  const capture = (uid: string, location: Pick<Unit, "name" | "kind"> & { file: string }) => {
    const unit = store.get(uid);
    if (!unit || done.has(uid)) return;
    done.add(uid);
    const followed = (state.get(location.file) ?? []).find((f) => f.code.name === location.name && (f.code.kind === "type") === (location.kind === "type"));
    if (followed) followed.recorded = true;
    if (!followed || followed.history.length === 0) return;
    // Prehistory is write-once: a walk that saw other evidence leaves what was recorded alone.
    if (unit.prehistory && !extendsPrehistory(unit.prehistory, followed.history)) {
      plan.kept++;
      return;
    }
    const entry: PrehistoryEntry = { uid, name: unit.name, file: unit.location.file, prehistory: followed.history };
    if (followed.stoppedAt) entry.stoppedAt = followed.stoppedAt;
    plan.units.push(entry);
  };

  commits.forEach((sha, i) => {
    const parent = i === 0 ? from : commits[i - 1];
    const changes = git(root, parent ? ["diff-tree", "-r", "--name-status", "-M", parent, sha] : ["diff-tree", "-r", "--name-status", "--root", sha])
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split("\t"));
    const recordedHere: Array<Pick<Unit, "name" | "kind"> & { file: string }> = [];
    for (const [status, path] of changes) {
      const added = /^\.poetics\/units\/(?:[^/]+\/)?([0-9A-Z]{26})\.json$/.exec(path ?? "");
      if (status === "A" && added) {
        const recorded = JSON.parse(showAt(root, sha, path!) ?? "{}") as Partial<Unit>;
        if (recorded.location && recorded.name && recorded.kind) {
          const location = { file: recorded.location.file, name: recorded.name, kind: recorded.kind };
          capture(added[1]!, location);
          recordedHere.push(location);
        }
      }
    }
    // A unit file committed with its code describes the code after this commit, so mark it once the commit is read.
    const markRecorded = () => {
      for (const location of recordedHere) {
        const followed = (state.get(location.file) ?? []).find((f) => f.code.name === location.name && (f.code.kind === "type") === (location.kind === "type"));
        if (followed) followed.recorded = true;
      }
    };
    const touched = new Set<string>();
    const present: string[] = [];
    for (const [status, first, second] of changes) {
      for (const file of [first, second]) if (file && indexable(file)) touched.add(file);
      const now = status?.startsWith("R") || status?.startsWith("C") ? second : first;
      if (now && status !== "D" && indexable(now)) present.push(now);
    }
    if (touched.size === 0) return markRecorded();

    const before = [...touched].flatMap((file) => state.get(file) ?? []);
    const after = present.flatMap((file) => {
      const text = showAt(root, sha, file);
      if (text === undefined) return [];
      const { units, source, lineOf } = detectIn(file, text, plugins);
      return units.map((unit) => {
        const tree = contentTree(unit);
        return {
          code: { key: unit.key, file, name: unit.name, kind: unit.kind, contentHash: contentHash(tree), fingerprint: fingerprint(tree) },
          framework: unit.framework,
          text: text.slice(unit.span.start, unit.span.end),
          runtimeHash: contentHash(contentTree(unit, true)),
          signature: signatureText(unit, source, plugins),
          startLine: lineOf(unit.span.start),
          endLine: lineOf(unit.span.end),
        };
      });
    });
    const ids = new Map(before.map((followed, n) => [`h${n}`, followed]));
    const result = matchIdentities(
      [...ids].map(([uid, followed]) => ({ ...followed.code, uid })),
      after.map((a) => a.code),
    );
    const afterByKey = new Map(after.map((a) => [a.code.key, a]));
    const info = read(sha);
    const found = pullsAt.get(sha);
    const changed: Array<{ followed: Followed; version: Omit<Version, "inferred"> }> = [];
    // What this commit's pull requests say about each version, kept for when its confidence is computed.
    const prsOf = new Map<Omit<Version, "inferred">, ReturnType<typeof pullRequestEvidence>>();
    const version = (parentHash: Hash | null, next: (typeof after)[number], change: ChangeClass, was?: Followed): Omit<Version, "inferred"> => {
      const v: Omit<Version, "inferred"> = {
        contentHash: next.code.contentHash,
        parent: parentHash,
        change,
        commit: sha,
        actor: info.agent ? { kind: "agent", tool: info.agent, reviewed: false } : { kind: "human" },
        rationale: info.body || info.subject || `Changed in ${sha.slice(0, 7)}; the commit does not say why.`,
      };
      const prs = pullRequestEvidence(info.rawSubject, found, { name: next.code.name, file: next.code.file, startLine: next.startLine, endLine: next.endLine });
      const links = dedupe([...info.issues.map((ref): Link => ({ kind: "github-issue", ref })), ...prs.links]);
      if (links.length > 0) v.links = links;
      prsOf.set(v, prs);
      if (range.drafter) {
        const lines = { name: next.code.name, file: next.code.file, startLine: next.startLine, endLine: next.endLine };
        requests.set(
          v as Version,
          draftRequest({
            unit: { name: next.code.name, kind: next.code.kind, file: next.code.file },
            change,
            commit: sha,
            code: next.text,
            ...(was ? { previous: was.text } : {}),
            evidence: [...(info.body || info.subject ? [{ source: "commit" as const, ref: sha, text: info.body || info.subject, quotable: true }] : []), ...(prText ? pullRequestTexts(found, lines) : [])],
          }),
        );
      }
      return v;
    };

    const next = new Map<string, Followed[]>();
    const place = (followed: Followed) => next.set(followed.code.file, [...(next.get(followed.code.file) ?? []), followed]);
    for (const match of result.matched) {
      const was = ids.get(match.uid)!;
      const now = afterByKey.get(match.key)!;
      const followed: Followed = { ...was, code: now.code, text: now.text, runtimeHash: now.runtimeHash, signature: now.signature };
      if (now.code.contentHash !== was.code.contentHash && was.history.length === 0) {
        // Code that was there when the range started: its first change here opens its prehistory, as created, and a
        // walk from further back that reaches it records the same version with its real change and parent.
        const v = version(null, now, "created");
        followed.history = [v as Version];
        followed.stoppedAt = { commit: sha, reason: startsAt! };
        changed.push({ followed, version: v });
      } else if (now.code.contentHash !== was.code.contentHash) {
        // Interface from the signature as written: the checker's hash would need this commit's dependencies.
        const change: ChangeClass = now.signature !== was.signature ? "interface" : now.runtimeHash === was.runtimeHash ? "cosmetic" : "behaviour";
        const v = version(was.code.contentHash, now, change, was);
        followed.history = [...was.history, v as Version];
        changed.push({ followed, version: v });
      }
      place(followed);
    }
    const queuedKeys = new Set(result.queued.flatMap((q) => q.keys));
    for (const created of [...result.created.map((c) => c.key), ...queuedKeys]) {
      const now = afterByKey.get(created)!;
      const v = version(null, now, "created");
      const followed: Followed = { code: now.code, framework: now.framework, text: now.text, runtimeHash: now.runtimeHash, signature: now.signature, history: [v as Version] };
      // A unit matching would only have queued starts afresh here; what came before is not claimed.
      if (queuedKeys.has(created)) followed.stoppedAt = { commit: sha, reason: result.queued.find((q) => q.keys.includes(created))!.reason };
      changed.push({ followed, version: v });
      place(followed);
    }
    for (const file of touched) state.delete(file);
    for (const [file, list] of next) state.set(file, list);
    markRecorded();

    // Text shared by everything a commit changed speaks to none of them in particular.
    const sources: Inferred["sources"] = info.body || info.subject ? ["commit"] : [];
    for (const { followed, version: v } of changed) {
      const prs = prsOf.get(v)!;
      // A doc comment says what the unit is, not why this commit changed it, so only a one-unit commit is specific.
      const base = confidenceOf({ reason: sources.length > 0, specific: changed.length === 1 });
      const last = followed.history.at(-1)!;
      last.inferred = { by: BY, confidence: withPullRequests(base, found, prs.speaks), sources: [...new Set([...sources, ...prs.sources])], drafted: false, reviewed: false };
    }

    // Exports this commit deleted before anyone recorded them. Matching is confident they are gone: a unit it would
    // only have queued is not claimed, and code present when the range started has no history here to recover.
    if (!range.includeRemoved) return;
    const gone = result.removed.map((r) => ids.get(r.uid)!).filter((was) => !was.recorded && was.history.length > 0 && !recovered.has(deletion(was.code.file, was.code.name, sha)));
    for (const was of gone) {
      const rationale = info.body || info.subject || `Deleted in ${sha.slice(0, 7)}; the commit does not say why.`;
      // The deletion has no lines left to review, so only a commit that deleted or changed nothing else speaks to it.
      const prs = pullRequestEvidence(info.rawSubject, found, { name: was.code.name, file: was.code.file, startLine: 0, endLine: -1 });
      const base = confidenceOf({ reason: sources.length > 0, specific: gone.length + changed.length === 1 });
      const confidence = withPullRequests(base, found, prs.speaks);
      const last = was.history.at(-1)!;
      const removed: Version = {
        contentHash: REMOVED_CONTENT_HASH,
        provisional: true,
        parent: last.contentHash,
        change: "removed",
        commit: sha,
        actor: info.agent ? { kind: "agent", tool: info.agent, reviewed: false } : { kind: "human" },
        rationale,
        inferred: { by: BY, confidence, sources: [...new Set([...sources, ...prs.sources])], drafted: false, reviewed: false },
      };
      const links = dedupe([...info.issues.map((ref): Link => ({ kind: "github-issue", ref })), ...prs.links]);
      if (links.length > 0) removed.links = links;
      if (range.drafter) {
        requests.set(
          removed,
          draftRequest({
            unit: { name: was.code.name, kind: was.code.kind, file: was.code.file },
            change: "removed",
            commit: sha,
            code: "",
            previous: was.text,
            evidence: [...(info.body || info.subject ? [{ source: "commit" as const, ref: sha, text: info.body || info.subject, quotable: true }] : []), ...(prText ? pullRequestTexts(found, { name: was.code.name, file: was.code.file, startLine: 0, endLine: -1 }) : [])],
          }),
        );
      }
      plan.removed.push({
        uid: mintUid(),
        kind: was.code.kind,
        framework: was.framework,
        name: was.code.name,
        location: { file: was.code.file },
        prehistory: was.history,
        // What a snapshot taken just before the deletion would have recorded: the code as it last was, then its removal.
        versions: [{ ...last, parent: null, change: "created" }, removed],
      });
    }
  });

  // Units whose unit file is not committed yet were recorded from the code as it is now, which a walk to HEAD reaches.
  for (const unit of store.values()) {
    if (done.has(unit.uid)) continue;
    if (to === head) capture(unit.uid, { file: unit.location.file, name: unit.name, kind: unit.kind });
    else plan.beyond++;
  }
  if (range.drafter) {
    // Only versions the plan will write are drafted.
    const versions = [...plan.units.flatMap((entry) => entry.prehistory), ...plan.removed.flatMap((unit) => [...unit.prehistory!, unit.versions[1]!])];
    const jobs = versions.flatMap((version) => (requests.has(version) ? [{ version, request: requests.get(version)! }] : []));
    plan.draft = await draftVersions(jobs, range.drafter, range.draftCache ? { cacheFile: range.draftCache } : {});
    // A recovered unit's created version is its last code, so it takes that version's drafted rationale.
    for (const unit of plan.removed) {
      const last = unit.prehistory!.at(-1)!;
      unit.versions[0] = { ...last, parent: null, change: "created" };
    }
    // Prehistory is write-once: drafted text that would change what was recorded is left alone.
    plan.units = plan.units.filter((entry) => {
      const recorded = store.get(entry.uid)?.prehistory;
      if (!recorded || extendsPrehistory(recorded, entry.prehistory)) return true;
      plan.kept++;
      return false;
    });
  }
  const byPlace = (a: { file: string; name: string }, b: { file: string; name: string }) => (a.file === b.file ? (a.name < b.name ? -1 : 1) : a.file < b.file ? -1 : 1);
  plan.units.sort(byPlace);
  plan.removed.sort((a, b) => byPlace({ file: a.location.file, name: a.name }, { file: b.location.file, name: b.name }));
  const tracker = pulls.use();
  if (tracker) plan.tracker = tracker;
  return plan;
}

/** Writes each unit's prehistory, unless it already has exactly that, and a unit file for each recovered deletion. Returns how many unit files changed. */
export async function applyPrehistory(root: string, plan: PrehistoryPlan, layout: StoreLayout = "flat"): Promise<number> {
  const paths = storePaths(root);
  let written = 0;
  for (const unit of plan.removed) {
    // Created as a snapshot just before the deletion would have, then removed, through the store's own rules.
    const [created, removed] = unit.versions;
    await createUnit({ paths, actor: created!.actor as Actor }, { ...unit, versions: [created!] }, layout);
    await appendVersion({ paths, actor: removed!.actor as Actor }, unit.uid, removed!);
    written++;
  }
  for (const entry of plan.units) {
    const unit = parseUnit((await readUnitFiles(paths)).find((file) => file.relativePath.endsWith(`${entry.uid}.json`))!);
    if (JSON.stringify(unit.prehistory ?? []) === JSON.stringify(entry.prehistory)) continue;
    await setPrehistory({ paths, actor: { kind: "human" } }, entry.uid, entry.prehistory);
    written++;
  }
  return written;
}

/** Whether pull request text may go to the drafter: the repository is public, or `--draft-private` says so. */
async function pullRequestTextAllowed(options: TrackerOptions & DraftOptions): Promise<boolean> {
  if (!options.drafter || !options.tracker) return false;
  if (options.draftPrivate) return true;
  try {
    return (await options.tracker.visibility?.()) === "public";
  } catch {
    return false;
  }
}

/** What the tracker added, or why it added nothing. */
function trackerLine(use: TrackerUse): string {
  const why: Record<TrackerStatus, string> = {
    used: `linked ${use.pullRequests} pull request(s)`,
    offline: "skipped (--offline); pull requests named in merge and squash subjects are still linked",
    "no-remote": "skipped: the origin remote is not on github.com",
    "no-token": "skipped: no GITHUB_TOKEN and no gh login",
    "rate-limited": `stopped at the rate limit after linking ${use.pullRequests} pull request(s); run again later to continue from the cache`,
  };
  return `${use.name === "github" ? "GitHub" : use.name}: ${why[use.status]}.`;
}

/** A ref or commit id as the full id of the commit it names. */
function resolveCommit(root: string, ref: string): string {
  try {
    return git(root, ["rev-parse", "--verify", "--quiet", "--end-of-options", `${ref}^{commit}`]).trim();
  } catch {
    throw new Error(`${ref} does not name a commit`);
  }
}

/** The prehistory plan for people: one line per unit with how far back it reaches, then a summary. */
export function formatPrehistoryPlan(plan: PrehistoryPlan, written?: number): string {
  const lines = plan.units.map((entry) => {
    const first = entry.prehistory[0]!;
    const stop = entry.stoppedAt ? `; stops at ${entry.stoppedAt.commit.slice(0, 7)} (${entry.stoppedAt.reason})` : "";
    return `${entry.file}#${entry.name}: ${entry.prehistory.length} version(s) back to ${first.commit!.slice(0, 7)}${stop}`;
  });
  const versions = plan.units.reduce((n, entry) => n + entry.prehistory.length, 0);
  const walked = `${plan.commits} commit(s)${plan.range.from ? ` after ${plan.range.from.slice(0, 7)}` : ""}`;
  const counts = `${versions} version(s) of prehistory for ${plan.units.length} unit(s), from ${walked}`;
  for (const unit of plan.removed) {
    const removed = unit.versions.at(-1)!;
    lines.push(`- ${unit.location.file}#${unit.name}: deleted in ${removed.commit!.slice(0, 7)} [${removed.inferred!.confidence}], ${unit.prehistory!.length} version(s) before; ${firstLine(removed.rationale)}`);
  }
  if (plan.removed.length > 0) lines.push(`${plan.removed.length} deleted export(s) would be recovered as removed units.`.replace("would be", written === undefined ? "would be" : "were"));
  if (plan.kept > 0) lines.push(`${plan.kept} unit(s) keep the prehistory already recorded, which this walk would not extend.`);
  if (plan.tracker) lines.push(trackerLine(plan.tracker));
  if (plan.draft) lines.push(...formatDraftReport(plan.draft));
  if (plan.beyond > 0) lines.push(`${plan.beyond} unit(s) were recorded after ${plan.range.to.slice(0, 7)}, where the range ends; walk to a later commit to reach them.`);
  lines.push(written === undefined ? `Would record ${counts}. Run with --write to record it.` : `Recorded ${counts}; ${written} unit file(s) changed.`);
  return lines.join("\n");
}
