// Swift edits for the identity gate (ADR 0026). Swift units come from an
// out-of-process adapter that reports lines, not syntax trees, so the gate's
// refactors find bodies and statements in the text: braces, parentheses and
// brackets outside strings and comments. That is enough for the edits the
// gate makes (insert a statement, cut a body in two, move a body or a whole
// declaration); the adapter then parses the result like any other code.

/** `text` with comments and string literals blanked to spaces, keeping every offset and newline. */
export function blankSwift(text: string): string {
  const out = text.split("");
  const blank = (from: number, to: number) => {
    for (let i = from; i < to; i++) if (out[i] !== "\n") out[i] = " ";
  };
  let i = 0;
  while (i < text.length) {
    if (text.startsWith("//", i)) {
      const end = text.indexOf("\n", i);
      const stop = end === -1 ? text.length : end;
      blank(i, stop);
      i = stop;
    } else if (text.startsWith("/*", i)) {
      // Swift block comments nest.
      let depth = 0;
      let j = i;
      while (j < text.length) {
        if (text.startsWith("/*", j)) {
          depth++;
          j += 2;
        } else if (text.startsWith("*/", j)) {
          depth--;
          j += 2;
          if (depth === 0) break;
        } else j++;
      }
      blank(i, j);
      i = j;
    } else if (text[i] === '"' || (text[i] === "#" && /^#+"/.test(text.slice(i, i + 8)))) {
      const hashes = text[i] === "#" ? /^#+/.exec(text.slice(i))![0] : "";
      const open = i + hashes.length;
      const multi = text.startsWith('"""', open);
      const close = (multi ? '"""' : '"') + hashes;
      let j = open + (multi ? 3 : 1);
      while (j < text.length) {
        if (!hashes && text[j] === "\\") j += 2;
        else if (text.startsWith(close, j)) {
          j += close.length;
          break;
        } else if (!multi && text[j] === "\n") break;
        else j++;
      }
      blank(i, j);
      i = j;
    } else i++;
  }
  return out.join("");
}

/** The offset each 1-based line starts at; index 0 is unused, and one past the last line is the text's length. */
export function lineStarts(text: string): number[] {
  const starts = [0, 0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  starts.push(text.length);
  return starts;
}

/** The 1-based line `offset` is on. */
export function lineOf(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text[i] === "\n") line++;
  return line;
}

/** Depth of `#if` blocks at the start of `line`: a declaration inside one is left alone, since moving it would split the block. */
export function ifDepthAt(text: string, line: number): number {
  let depth = 0;
  const lines = blankSwift(text).split("\n");
  for (let n = 0; n < line - 1 && n < lines.length; n++) {
    const trimmed = lines[n]!.trim();
    if (/^#if\b/.test(trimmed)) depth++;
    else if (/^#endif\b/.test(trimmed)) depth--;
  }
  return depth;
}

/** Brace depth at `offset`, counting from the start of the text. */
export function braceDepthAt(text: string, offset: number): number {
  const code = blankSwift(text);
  let depth = 0;
  for (let i = 0; i < offset; i++) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}") depth--;
  }
  return depth;
}

export interface SwiftBody {
  /** Offset of the `{` that opens the body. */
  open: number;
  /** Offset of the `}` that closes it. */
  close: number;
  /** Line-start offsets of the body's top-level statements. */
  statements: number[];
}

/**
 * The body of the `func` or `init` declared on lines `startLine`–`endLine`: the first `{` outside parentheses and
 * brackets after the keyword, and the statements directly in it. Undefined for anything else (a type, a computed
 * property, a protocol requirement).
 */
export function swiftBody(text: string, startLine: number, endLine: number): SwiftBody | undefined {
  const code = blankSwift(text);
  const starts = lineStarts(text);
  const from = starts[startLine]!;
  const to = starts[Math.min(endLine + 1, starts.length - 1)]!;
  const keyword = /\b(func|init)\b/.exec(code.slice(from, to));
  // The keyword must be the declaration's own, not one inside a computed property's or a type's braces.
  if (!keyword || code.slice(from, from + keyword.index).includes("{")) return undefined;
  let nesting = 0;
  let open = -1;
  for (let i = from + keyword.index; i < to; i++) {
    const c = code[i];
    if (c === "(" || c === "[") nesting++;
    else if (c === ")" || c === "]") nesting--;
    else if (c === "{" && nesting === 0) {
      open = i;
      break;
    }
  }
  if (open === -1) return undefined;
  let depth = 0;
  let close = -1;
  for (let i = open; i < code.length; i++) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}" && --depth === 0) {
      close = i;
      break;
    }
  }
  if (close === -1) return undefined;
  return { open, close, statements: statementStarts(code, open, close) };
}

const CONTINUES_LINE = /^(\.|\}|\)|\]|else\b|catch\b|where\b|&&|\|\||\?\?|[?:+\-*/=<>,])/;
const LEAVES_LINE_OPEN = /(\(|\[|,|=|&&|\|\||\?\?|[+\-*/:?]|\bin|->)$/;

/** Line starts of statements directly in a body: lines at its top level that do not continue the line before. */
function statementStarts(code: string, open: number, close: number): number[] {
  const starts: number[] = [];
  let depth = 0;
  let previous = "{";
  let i = code.indexOf("\n", open) + 1;
  while (i > 0 && i < close) {
    const newline = code.indexOf("\n", i);
    const end = newline === -1 || newline > close ? close : newline;
    const line = code.slice(i, end).trim();
    if (line) {
      if (depth === 0 && !CONTINUES_LINE.test(line) && !LEAVES_LINE_OPEN.test(previous)) starts.push(i);
      previous = line;
    }
    for (let j = i; j < end; j++) {
      if ("{([".includes(code[j]!)) depth++;
      else if ("})]".includes(code[j]!)) depth--;
    }
    i = end + 1;
  }
  return starts;
}

/** The leading whitespace of the line `offset` is on. */
function indentAt(text: string, offset: number): string {
  const start = text.lastIndexOf("\n", offset - 1) + 1;
  return /^[ \t]*/.exec(text.slice(start))![0];
}

/** Inserts a statement at the top of the body, as the `rename-edit` refactor does. */
export function insertStatement(text: string, body: SwiftBody): string {
  const first = body.statements[0];
  const indent = first === undefined ? `${indentAt(text, body.open)}    ` : indentAt(text, first);
  return `${text.slice(0, body.open + 1)}\n${indent}_ = 0${text.slice(body.open + 1)}`;
}

/**
 * Cuts the body in two at its middle statement: the first half stays, and the rest becomes `func <rest>()` right
 * after it, in the same scope. Undefined when the body has fewer than `min` statements.
 */
export function splitBody(text: string, body: SwiftBody, rest: string, min = 4): string | undefined {
  if (body.statements.length < min) return undefined;
  const cut = body.statements[Math.floor(body.statements.length / 2)]!;
  const indent = indentAt(text, body.open);
  // The original closing brace now closes the new function.
  return `${text.slice(0, cut)}${indent}}\n\n${indent}func ${rest}() {\n${text.slice(cut)}`;
}

/** The whole lines `startLine`–`endLine`, with the doc comment lines directly above them. */
export function declarationLines(text: string, startLine: number, endLine: number): { start: number; end: number } {
  const starts = lineStarts(text);
  let first = startLine;
  const lines = text.split("\n");
  while (first > 1 && /^\s*(\/\/\/|@)/.test(lines[first - 2]!)) first--;
  return { start: starts[first]!, end: starts[Math.min(endLine + 1, starts.length - 1)]! };
}

/** Moves `second`'s statements to the end of `first`'s body and deletes `second`, as the `merge` refactor does. */
export function mergeBodies(text: string, first: SwiftBody, second: SwiftBody, secondLines: { start: number; end: number }): string {
  const inner = text.slice(second.open + 1, second.close);
  const insert = (t: string) => `${t.slice(0, first.close)}${inner.trimEnd()}\n${indentAt(text, first.open)}${t.slice(first.close)}`;
  const remove = (t: string) => t.slice(0, secondLines.start) + t.slice(secondLines.end);
  // Two edits to one text: the later one first, so the earlier one's offsets still hold.
  return secondLines.start > first.close ? insert(remove(text)) : remove(insert(text));
}

const DECLARES = /\b(?:func|var|let|case|class|struct|enum|protocol|actor|typealias|associatedtype)\s+`?([A-Za-z_]\w*)/g;

/**
 * How many times each name is declared in `texts`, units or not: stored properties, enum cases and private
 * declarations too. A rename by text is only an editor's rename when the name is declared once.
 */
export function swiftDeclarations(texts: Iterable<string>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const text of texts) {
    for (const match of blankSwift(text).matchAll(DECLARES)) counts.set(match[1]!, (counts.get(match[1]!) ?? 0) + 1);
  }
  return counts;
}

const LABELS = /[(,]\s*([A-Za-z_]\w*)(?:\s+[A-Za-z_]\w*)?\s*:/g;

/**
 * Every word used as an argument label or parameter name in `texts`, at a call or a declaration. A textual rename
 * would rewrite these too, which an editor's rename of a declaration never does.
 */
export function swiftLabels(texts: Iterable<string>): Set<string> {
  const labels = new Set<string>();
  for (const text of texts) for (const match of blankSwift(text).matchAll(LABELS)) labels.add(match[1]!);
  return labels;
}

/** A Swift unit's name without its container or argument labels: `draw` for `Canvas.draw(_:in:)`. */
export function swiftBaseName(name: string): string {
  const bare = name.split("(")[0]!;
  return bare.slice(bare.lastIndexOf(".") + 1);
}

/** The container part of a qualified name, with its trailing dot: `Canvas.` for `Canvas.draw(_:in:)`, `` for `clamp(_:)`. */
export function swiftContainer(name: string): string {
  const bare = name.split("(")[0]!;
  return bare.slice(0, bare.lastIndexOf(".") + 1);
}

/** `name` with its base name replaced: `Canvas.drawGate(_:in:)` for `Canvas.draw(_:in:)` and `drawGate`. */
export function renameSwift(name: string, to: string): string {
  const paren = name.indexOf("(");
  const labels = paren === -1 ? "" : name.slice(paren);
  return `${swiftContainer(name)}${to}${labels}`;
}
