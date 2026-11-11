// Reading a source map's mappings back to original offsets, so units, lines
// and unresolved uses found in svelte2tsx output point at the .svelte file.
// Small enough to own rather than add a dependency for.

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const DIGIT = new Map([...BASE64].map((char, i) => [char, i]));

/** One mapped segment: where a run of generated text starts, and the original line and column it came from. */
interface Segment {
  column: number;
  line: number;
  originalColumn: number;
}

/** Decodes a version 3 `mappings` string into segments per generated line, each line sorted by column. */
export function decodeMappings(mappings: string): Segment[][] {
  const lines: Segment[][] = [];
  let originalLine = 0;
  let originalColumn = 0;
  for (const text of mappings.split(";")) {
    const segments: Segment[] = [];
    let column = 0;
    for (const field of text.split(",")) {
      if (field === "") continue;
      const values = decodeVlq(field);
      column += values[0] ?? 0;
      // A segment with one field maps nothing; with four or more, values 2 and 3 move the original position.
      if (values.length >= 4) {
        originalLine += values[2]!;
        originalColumn += values[3]!;
        segments.push({ column, line: originalLine, originalColumn });
      }
    }
    lines.push(segments.sort((a, b) => a.column - b.column));
  }
  return lines;
}

function decodeVlq(field: string): number[] {
  const values: number[] = [];
  let value = 0;
  let shift = 0;
  for (const char of field) {
    const digit = DIGIT.get(char);
    if (digit === undefined) throw new Error(`Invalid source map character: ${char}`);
    value += (digit & 31) << shift;
    if (digit & 32) {
      shift += 5;
    } else {
      values.push(value & 1 ? -(value >>> 1) : value >>> 1);
      value = 0;
      shift = 0;
    }
  }
  return values;
}

/**
 * Maps offsets in `generated` back to offsets in `original`. An offset maps
 * through the nearest segment at or before it on its line, moved by the same
 * distance; an offset with no segment before it on its line is generated-only
 * code and maps to undefined.
 */
export function offsetMapper(mappings: string, generated: string, original: string): (offset: number) => number | undefined {
  const segments = decodeMappings(mappings);
  const generatedLines = lineStarts(generated);
  const originalLines = lineStarts(original);
  return (offset) => {
    if (offset < 0 || offset > generated.length) return undefined;
    const line = lineOf(generatedLines, offset);
    const column = offset - generatedLines[line]!;
    const onLine = segments[line] ?? [];
    let found: Segment | undefined;
    for (const segment of onLine) {
      if (segment.column > column) break;
      found = segment;
    }
    if (!found) return undefined;
    const start = originalLines[found.line];
    if (start === undefined) return undefined;
    return Math.min(original.length, start + found.originalColumn + (column - found.column));
  };
}

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  return starts;
}

function lineOf(starts: readonly number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (starts[mid]! <= offset) low = mid;
    else high = mid - 1;
  }
  return low;
}
