// A small glob matcher for config include/exclude patterns: `**`, `*`, `?` and
// `{a,b}`. Kept local because fs.glob's stability and brace support differ
// across the Node versions we run on.

/** Converts a POSIX glob to an anchored regular expression. */
export function globToRegExp(pattern: string): RegExp {
  let source = "";
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]!;
    if (char === "*") {
      if (pattern[i + 1] === "*") {
        // `**/` matches zero or more directories; a trailing `**` matches anything.
        if (pattern[i + 2] === "/") {
          source += "(?:.*/)?";
          i += 2;
        } else {
          source += ".*";
          i += 1;
        }
      } else {
        source += "[^/]*";
      }
    } else if (char === "?") {
      source += "[^/]";
    } else if (char === "{") {
      const end = pattern.indexOf("}", i);
      if (end === -1) {
        source += "\\{";
        continue;
      }
      const options = pattern.slice(i + 1, end).split(",").map((option) => globToRegExp(option).source.slice(1, -1));
      source += `(?:${options.join("|")})`;
      i = end;
    } else {
      source += char.replace(/[.+^$()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}$`);
}

/** True when `path` (repo-relative, POSIX) matches any include and no exclude pattern. */
export function createMatcher(include: readonly string[], exclude: readonly string[] = []): (path: string) => boolean {
  const includes = include.map(globToRegExp);
  const excludes = exclude.map(globToRegExp);
  return (path) => includes.some((re) => re.test(path)) && !excludes.some((re) => re.test(path));
}
