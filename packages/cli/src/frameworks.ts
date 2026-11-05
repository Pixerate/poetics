// Which framework plugins the TypeScript indexer runs for a repository, from the
// adapters its config lists.
import { reactPlugin } from "@poetics/adapter-react";
import type { FrameworkPlugin } from "@poetics/adapter-typescript";

/** The plugins for `config.adapters`: React's when `react` is listed. Svelte's arrives with its adapter. */
export function pluginsFor(config: { adapters?: readonly string[] }): FrameworkPlugin[] {
  return config.adapters?.includes("react") ? [reactPlugin()] : [];
}
