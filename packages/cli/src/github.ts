// GitHub behind the IssueTracker interface (ADR 0011): the pull requests that
// contain a commit, and their review comments. Read-only, cached under
// .poetics/cache/ so a re-run makes no repeat calls, and a rate limit stops
// the collectors rather than failing the backfill.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { IssueTracker, TrackedIssue, TrackedPullRequest, TrackedReviewComment } from "@poetics/core";
import { storePaths } from "@poetics/store";

/** GitHub answered with a rate limit: stop asking for this run. */
export class RateLimitedError extends Error {}

export interface GitHubTrackerOptions {
  /** `owner/name`. */
  repo: string;
  token: string;
  /** Responses are kept here between runs; nothing is cached without it. */
  cacheFile?: string;
  fetch?: typeof fetch;
  api?: string;
}

export interface GitHubTracker extends IssueTracker {
  /** Writes the response cache. */
  flush(): Promise<void>;
  /** Calls made to the API this run, not answered from the cache. */
  readonly requests: number;
}

/** A GitHub tracker for `options.repo`. */
export function createGitHubTracker(options: GitHubTrackerOptions): GitHubTracker {
  const api = options.api ?? "https://api.github.com";
  const call = options.fetch ?? fetch;
  const cache: Record<string, unknown[]> = options.cacheFile && existsSync(options.cacheFile) ? readCache(options.cacheFile) : {};
  let requests = 0;

  // Every page of a list endpoint, from the cache when this run or an earlier one fetched it.
  const list = async (path: string): Promise<unknown[]> => {
    if (cache[path]) return cache[path];
    const items: unknown[] = [];
    let url: string | undefined = `${api}/repos/${options.repo}${path}${path.includes("?") ? "&" : "?"}per_page=100`;
    while (url) {
      requests++;
      const response = await call(url, { headers: { accept: "application/vnd.github+json", authorization: `Bearer ${options.token}`, "x-github-api-version": "2022-11-28" } });
      if (response.status === 404 || response.status === 422) break;
      if (response.status === 429 || (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0")) throw new RateLimitedError("GitHub rate limit reached");
      if (!response.ok) throw new Error(`GitHub answered ${response.status} for ${url}`);
      items.push(...((await response.json()) as unknown[]));
      url = /<([^>]+)>;\s*rel="next"/.exec(response.headers.get("link") ?? "")?.[1];
    }
    cache[path] = items;
    return items;
  };

  // A single object, cached like the lists.
  const one = async (path: string): Promise<unknown> => {
    if (cache[path]) return cache[path][0];
    requests++;
    const response = await call(`${api}/repos/${options.repo}${path}`, { headers: { accept: "application/vnd.github+json", authorization: `Bearer ${options.token}`, "x-github-api-version": "2022-11-28" } });
    if (response.status === 429 || (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0")) throw new RateLimitedError("GitHub rate limit reached");
    if (!response.ok) return undefined;
    const body = (await response.json()) as unknown;
    cache[path] = [body];
    return body;
  };

  return {
    name: "github",
    async visibility() {
      const repo = (await one("")) as { private?: boolean } | undefined;
      return repo?.private === false ? "public" : "private";
    },
    get requests() {
      return requests;
    },
    async pullRequestsFor(commit) {
      const pulls = (await list(`/commits/${commit}/pulls`)) as Array<{ number: number; html_url: string; title: string; body: string | null; labels?: Array<{ name: string }> }>;
      return pulls.map((pr): TrackedPullRequest => ({ number: pr.number, url: pr.html_url, title: pr.title, body: pr.body ?? "", labels: (pr.labels ?? []).map((label) => label.name) }));
    },
    async reviewComments(pullRequest) {
      const comments = (await list(`/pulls/${pullRequest}/comments`)) as Array<{ path: string; line?: number | null; start_line?: number | null; original_line?: number | null; original_start_line?: number | null; body: string }>;
      return comments.flatMap((comment): TrackedReviewComment[] => {
        const end = comment.line ?? comment.original_line;
        if (!end) return [];
        return [{ path: comment.path, startLine: comment.start_line ?? comment.original_start_line ?? end, endLine: end, body: comment.body }];
      });
    },
    async issue(number) {
      const issue = (await one(`/issues/${number}`)) as
        | { number: number; html_url: string; title: string; body: string | null; state: string; labels?: Array<{ name: string } | string>; pull_request?: unknown }
        | undefined;
      if (!issue) return undefined;
      return {
        number: issue.number,
        url: issue.html_url,
        title: issue.title,
        body: issue.body ?? "",
        state: issue.state === "closed" ? "closed" : "open",
        labels: (issue.labels ?? []).map((label) => (typeof label === "string" ? label : label.name)),
        pullRequest: issue.pull_request !== undefined,
      } satisfies TrackedIssue;
    },
    async flush() {
      if (!options.cacheFile) return;
      await mkdir(dirname(options.cacheFile), { recursive: true });
      await writeFile(options.cacheFile, JSON.stringify(cache));
    },
  };
}

/** `owner/name` from the `origin` remote, when it is on github.com. */
export function githubRepoOf(root: string): string | undefined {
  let url: string;
  try {
    // Quietly: a repository without an origin is an answer, not an error to print.
    url = execFileSync("git", ["remote", "get-url", "origin"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return undefined;
  }
  return /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/.exec(url)?.[1];
}

/** A token from `GITHUB_TOKEN`, else from the GitHub CLI's login. Never from `.poetics/`. */
export function githubToken(env: NodeJS.ProcessEnv = process.env, gh: () => string = ghAuthToken): string | undefined {
  if (env["GITHUB_TOKEN"]) return env["GITHUB_TOKEN"];
  try {
    return gh().trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Why there is no tracker, for the report: the collectors that need one were skipped. */
export type TrackerStatus = "used" | "offline" | "no-remote" | "no-token" | "rate-limited";

/** The GitHub tracker for `root`, unless backfill runs offline or the repository or a token is missing. */
export function connectGitHub(root: string, options: { offline?: boolean; env?: NodeJS.ProcessEnv; gh?: () => string; fetch?: typeof fetch } = {}): { tracker?: GitHubTracker; status: TrackerStatus } {
  if (options.offline) return { status: "offline" };
  const repo = githubRepoOf(root);
  if (!repo) return { status: "no-remote" };
  const token = githubToken(options.env, options.gh);
  if (!token) return { status: "no-token" };
  const tracker = createGitHubTracker({ repo, token, cacheFile: join(storePaths(root).cache, "github.json"), ...(options.fetch ? { fetch: options.fetch } : {}) });
  return { tracker, status: "used" };
}

function ghAuthToken(): string {
  return execFileSync("gh", ["auth", "token"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 });
}

function readCache(file: string): Record<string, unknown[]> {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown[]>;
  } catch {
    return {};
  }
}
