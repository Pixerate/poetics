import { notImplemented } from "@poetics/core";
import type { CandidateEdge, FrameworkAdapter, UnitCandidate, UnresolvedEdge } from "@poetics/core";

export type SvelteMajor = 4 | 5;

/** `.svelte` files are components; `.svelte.ts` / `.svelte.js` are rune modules indexed as TypeScript. */
export function svelteFileKind(file: string): "component" | "rune-module" | undefined {
  if (file.endsWith(".svelte")) return "component";
  if (/\.svelte\.(ts|js)$/.test(file)) return "rune-module";
  return undefined;
}

/** The component name Svelte tooling uses: the file's basename. */
export function componentNameFromFile(file: string): string {
  const base = file.split(/[\\/]/).pop() ?? file;
  return base.replace(/\.svelte$/, "");
}

/**
 * Best-effort Svelte major for one component: `$props()` means 5; `export let`
 * or `createEventDispatcher` means 4. Mixed codebases are expected.
 */
export function detectSvelteMajor(source: string): SvelteMajor | undefined {
  if (/\$props\s*\(/.test(source)) return 5;
  if (/\bexport\s+let\b|\bcreateEventDispatcher\b/.test(source)) return 4;
  return undefined;
}

/** Indexes svelte2tsx output with the shared TypeScript checker, mapping spans back to the `.svelte` file. */
export function createSvelteAdapter(_options: { tsconfig: string }): FrameworkAdapter {
  return {
    framework: "svelte",
    extensions: [".svelte", ".svelte.ts", ".svelte.js"],
    detectUnits(_file: string): UnitCandidate[] {
      return notImplemented("adapter-svelte detectUnits");
    },
    interfaceOf(_unit: UnitCandidate): unknown {
      return notImplemented("adapter-svelte interfaceOf");
    },
    edgesOf(_unit: UnitCandidate): { edges: CandidateEdge[]; unresolved: Omit<UnresolvedEdge, "from">[] } {
      return notImplemented("adapter-svelte edgesOf");
    },
  };
}
