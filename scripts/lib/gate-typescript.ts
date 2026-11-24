// What the gate's rename by text would rewrite in TypeScript and Svelte where
// an editor's rename would not. The gate's units there are declared at the top
// level, so the same word in a string or after a `.` is never the unit.

const STRINGS = /(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/g;
const AFTER_DOT = /(?<!\.)\.\s*([A-Za-z_$][\w$]*)/g;
const WORDS = /[A-Za-z_$][\w$]*/g;

/**
 * Every word in `texts` inside a string literal or after a `.`: a rename by text would rewrite them, and an editor's
 * rename of a top-level declaration never does. It errs towards finding too many (a template's `${}` counts as
 * string, and so does text between apostrophes in markup), which only leaves a name out of the gate's renames.
 */
export function textOnlyWords(texts: Iterable<string>): Set<string> {
  const words = new Set<string>();
  for (const text of texts) {
    for (const match of text.matchAll(STRINGS)) for (const word of match[2]!.matchAll(WORDS)) words.add(word[0]);
    for (const match of text.matchAll(AFTER_DOT)) words.add(match[1]!);
  }
  return words;
}
