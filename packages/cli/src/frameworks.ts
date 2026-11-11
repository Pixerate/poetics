// Which framework plugins the TypeScript indexer runs for a repository, from the
// adapters its config lists.
import { reactPlugin } from "@poetics/adapter-react";
import { sveltePlugin } from "@poetics/adapter-svelte";
import type { FrameworkPlugin } from "@poetics/adapter-typescript";

/**
 * The plugins for `config.adapters`: Svelte's when `svelte` is listed (ADR 0020), React's when `react` is. The first
 * plugin to claim a unit wins, so Svelte's goes first: it claims only in Svelte files, where a rune helper named
 * `use*` is Svelte's, not one of React's hooks.
 */
export function pluginsFor(config: { adapters?: readonly string[] }): FrameworkPlugin[] {
  return [...(config.adapters?.includes("svelte") ? [sveltePlugin()] : []), ...(config.adapters?.includes("react") ? [reactPlugin()] : [])];
}
