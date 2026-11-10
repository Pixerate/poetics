import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RateLimitedError, connectGitHub, createGitHubTracker, githubRepoOf, githubToken } from "./github.ts";
import { runGit } from "./test-helpers.ts";

/** A fetch that answers from `routes` by path and query, recording each URL it was asked for. */
function fakeFetch(routes: Record<string, { status?: number; body?: unknown; headers?: Record<string, string> }>) {
  const calls: string[] = [];
  const fn = (async (input: string | URL) => {
    const url = String(input);
    calls.push(url);
    const path = url.replace("https://api.github.com/repos/acme/shop", "");
    const route = routes[path] ?? { status: 404, body: { message: "Not Found" } };
    return new Response(JSON.stringify(route.body ?? []), { status: route.status ?? 200, headers: route.headers ?? {} });
  }) as typeof fetch;
  return { fn, calls };
}

const PULL = { number: 12, html_url: "https://github.com/acme/shop/pull/12", title: "Round prices", body: "Fixes #3", labels: [{ name: "bug" }] };

describe("createGitHubTracker", () => {
  it("lists the pull requests that contain a commit, following pagination", async () => {
    const { fn, calls } = fakeFetch({
      "/commits/abc/pulls?per_page=100": { body: [PULL], headers: { link: '<https://api.github.com/repos/acme/shop/commits/abc/pulls?per_page=100&page=2>; rel="next"' } },
      "/commits/abc/pulls?per_page=100&page=2": { body: [{ ...PULL, number: 13, html_url: "u13", body: null, labels: undefined }] },
    });
    const tracker = createGitHubTracker({ repo: "acme/shop", token: "t", fetch: fn });
    expect(await tracker.pullRequestsFor("abc")).toEqual([
      { number: 12, url: "https://github.com/acme/shop/pull/12", title: "Round prices", body: "Fixes #3", labels: ["bug"] },
      { number: 13, url: "u13", title: "Round prices", body: "", labels: [] },
    ]);
    expect(calls).toHaveLength(2);
    expect(tracker.requests).toBe(2);
  });

  it("gives review comments the lines they were left on, and skips comments on no line", async () => {
    const { fn } = fakeFetch({
      "/pulls/12/comments?per_page=100": {
        body: [
          { path: "src/a.ts", line: 9, start_line: 7, body: "x" },
          { path: "src/a.ts", line: null, original_line: 4, body: "outdated" },
          { path: "src/a.ts", line: null, original_line: null, body: "file-level" },
        ],
      },
    });
    expect(await createGitHubTracker({ repo: "acme/shop", token: "t", fetch: fn }).reviewComments(12)).toEqual([
      { path: "src/a.ts", startLine: 7, endLine: 9, body: "x" },
      { path: "src/a.ts", startLine: 4, endLine: 4, body: "outdated" },
    ]);
  });

  it("answers a commit GitHub does not know with no pull requests, and stops at a rate limit", async () => {
    const { fn } = fakeFetch({ "/commits/limited/pulls?per_page=100": { status: 403, headers: { "x-ratelimit-remaining": "0" } } });
    const tracker = createGitHubTracker({ repo: "acme/shop", token: "t", fetch: fn });
    expect(await tracker.pullRequestsFor("unknown")).toEqual([]);
    await expect(tracker.pullRequestsFor("limited")).rejects.toBeInstanceOf(RateLimitedError);
  });

  it("answers repeat questions from its cache, across runs once flushed", async () => {
    const cacheFile = join(await mkdtemp(join(tmpdir(), "poetics-github-")), "cache", "github.json");
    const first = fakeFetch({ "/commits/abc/pulls?per_page=100": { body: [PULL] } });
    const tracker = createGitHubTracker({ repo: "acme/shop", token: "t", fetch: first.fn, cacheFile });
    await tracker.pullRequestsFor("abc");
    await tracker.pullRequestsFor("abc");
    expect(first.calls).toHaveLength(1);
    await tracker.flush();
    expect(existsSync(cacheFile)).toBe(true);
    const second = fakeFetch({});
    expect((await createGitHubTracker({ repo: "acme/shop", token: "t", fetch: second.fn, cacheFile }).pullRequestsFor("abc"))[0]!.number).toBe(12);
    expect(second.calls).toEqual([]);
  });

  it("sends the token as a bearer header and fails on other errors", async () => {
    let auth: string | null = null;
    const fn = (async (_url: string, init?: RequestInit) => {
      auth = new Headers(init?.headers).get("authorization");
      return new Response("{}", { status: 500 });
    }) as typeof fetch;
    await expect(createGitHubTracker({ repo: "acme/shop", token: "secret", fetch: fn }).pullRequestsFor("abc")).rejects.toThrow(/GitHub answered 500/);
    expect(auth).toBe("Bearer secret");
  });
});

describe("githubRepoOf", () => {
  it("reads owner/name from an https or ssh origin on github.com, and nothing otherwise", async () => {
    const root = await mkdtemp(join(tmpdir(), "poetics-remote-"));
    runGit(root, "init", "-q");
    expect(githubRepoOf(root)).toBeUndefined();
    for (const [url, repo] of [
      ["https://github.com/acme/shop.git", "acme/shop"],
      ["git@github.com:acme/shop.git", "acme/shop"],
      ["https://github.com/acme/shop", "acme/shop"],
      ["https://gitlab.com/acme/shop.git", undefined],
    ] as const) {
      runGit(root, "remote", "add", "origin", url);
      expect([url, githubRepoOf(root)]).toEqual([url, repo]);
      runGit(root, "remote", "remove", "origin");
    }
  });
});

describe("githubToken", () => {
  it("prefers GITHUB_TOKEN, then the gh login, and gives up quietly", () => {
    expect(githubToken({ GITHUB_TOKEN: "env" }, () => "gh")).toBe("env");
    expect(githubToken({}, () => "gh\n")).toBe("gh");
    expect(
      githubToken({}, () => {
        throw new Error("gh not installed");
      }),
    ).toBeUndefined();
    expect(githubToken({}, () => "")).toBeUndefined();
  });
});

describe("connectGitHub", () => {
  it("says why there is no tracker: offline, no GitHub remote, or no token", async () => {
    const root = await mkdtemp(join(tmpdir(), "poetics-connect-"));
    runGit(root, "init", "-q");
    const noGh = () => {
      throw new Error("no gh");
    };
    expect(connectGitHub(root, { offline: true }).status).toBe("offline");
    expect(connectGitHub(root, { env: {}, gh: noGh }).status).toBe("no-remote");
    runGit(root, "remote", "add", "origin", "https://github.com/acme/shop.git");
    expect(connectGitHub(root, { env: {}, gh: noGh }).status).toBe("no-token");
    const connected = connectGitHub(root, { env: { GITHUB_TOKEN: "t" }, gh: noGh });
    expect([connected.status, connected.tracker?.name]).toEqual(["used", "github"]);
  });
});
