import { notImplemented } from "@poetics/core";
import type { CandidateEdge, FrameworkAdapter, UnitCandidate, UnresolvedEdge } from "@poetics/core";

/** Wrappers whose argument is still a component. */
export const COMPONENT_WRAPPERS = ["memo", "forwardRef", "lazy"] as const;

/** `use` followed by a capital letter, per the Rules of Hooks. */
export function isHookName(name: string): boolean {
  return /^use[A-Z0-9]/.test(name);
}

/** PascalCase names are component candidates; the adapter still checks they return JSX. */
export function isComponentName(name: string): boolean {
  return /^[A-Z][A-Za-z0-9]*$/.test(name);
}

export interface ReactAdapterOptions {
  /** Path to the tsconfig the TypeScript program is built from. */
  tsconfig: string;
}

/** Detects components, hooks and functions in `.ts` and `.tsx` via ts-morph. */
export function createReactAdapter(_options: ReactAdapterOptions): FrameworkAdapter {
  return {
    framework: "react",
    extensions: [".ts", ".tsx"],
    detectUnits(_file: string): UnitCandidate[] {
      return notImplemented("adapter-react detectUnits");
    },
    interfaceOf(_unit: UnitCandidate): unknown {
      return notImplemented("adapter-react interfaceOf");
    },
    edgesOf(_unit: UnitCandidate): { edges: CandidateEdge[]; unresolved: Omit<UnresolvedEdge, "from">[] } {
      return notImplemented("adapter-react edgesOf");
    },
  };
}
