// Which framework plugins the TypeScript indexer runs for a repository, from the
// adapters its config lists.
import { reactPlugin } from "@poetics/adapter-react";
import { sveltePlugin } from "@poetics/adapter-svelte";
import type { FrameworkPlugin } from "@poetics/adapter-typescript";

/** The plugins for `config.adapters`: React's when `react` is listed, Svelte's when `svelte` is (ADR 0020). */
export function pluginsFor(config: { adapters?: readonly string[] }): FrameworkPlugin[] {
  return [...(config.adapters?.includes("react") ? [reactPlugin()] : []), ...(config.adapters?.includes("svelte") ? [sveltePlugin()] : [])];
}
