<!-- @component
A note in Svelte 4 syntax, kept so the adapter's Svelte 4 interfaces are exercised: `export let` props, a dispatched event and named slots.
-->
<script lang="ts">
  import { createEventDispatcher } from "svelte";

  export let tone: "info" | "sale" = "info";

  const dispatch = createEventDispatcher<{ dismiss: { tone: string } }>();
</script>

<p class="note {tone}">
  <slot />
  <button aria-label="Dismiss" on:click={() => dispatch("dismiss", { tone })}>×</button>
</p>
<slot name="footer" {tone} />
