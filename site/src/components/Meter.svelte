<script lang="ts">
  import { percent } from "../lib/query.ts";
  import type { Ratio } from "../lib/types.ts";

  interface MeterProps {
    label: string;
    hint: string;
    value: Ratio;
    threshold?: number | undefined;
  }

  let { label, hint, value, threshold }: MeterProps = $props();
  const below = $derived(threshold !== undefined && value.ratio < threshold);
</script>

<div class="meter card">
  <div class="top">
    <span class="label">{label}</span>
    {#if threshold !== undefined}
      <span class={`chip ${below ? "bad" : "good"}`}>min {percent(threshold)}</span>
    {/if}
  </div>
  <div class="value">{value.total === 0 ? "—" : percent(value.ratio)}</div>
  <div class="bar" role="img" aria-label={`${label}: ${value.covered} of ${value.total}`}>
    <div class="fill" class:below style:width={`${value.ratio * 100}%`}></div>
    {#if threshold !== undefined}
      <div class="mark" style:left={`${threshold * 100}%`}></div>
    {/if}
  </div>
  <div class="hint muted">{value.covered} of {value.total} · {hint}</div>
</div>

<style>
  .meter {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
  }

  .label {
    font-weight: 600;
  }

  .value {
    font-family: var(--serif);
    font-size: 30px;
    font-weight: 600;
    line-height: 1.1;
  }

  .bar {
    position: relative;
    height: 6px;
    border-radius: 3px;
    background: var(--surface-2);
  }

  .fill {
    height: 100%;
    border-radius: 3px;
    background: var(--accent);
  }

  .fill.below {
    background: var(--bad);
  }

  .mark {
    position: absolute;
    top: -3px;
    width: 2px;
    height: 12px;
    margin-left: -1px;
    background: var(--text);
    opacity: 0.55;
  }

  .hint {
    font-size: 13px;
  }
</style>
