<script lang="ts">
  import { inlineCode } from "../lib/query.ts";

  let { text }: { text: string } = $props();
</script>

{#each inlineCode(text) as segment, i (i)}{#if segment.code}<code>{segment.text}</code>{:else}{segment.text}{/if}{/each}
