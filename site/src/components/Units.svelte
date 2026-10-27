<script lang="ts">
  import UnitDetail from "./UnitDetail.svelte";
  import { filterUnits } from "../lib/query.ts";
  import type { SiteData } from "../lib/types.ts";

  interface UnitsProps {
    data: SiteData;
    selected: string | undefined;
    initialArea: string;
  }

  let { data, selected, initialArea }: UnitsProps = $props();

  let query = $state("");
  let area = $state("");
  let kind = $state("");

  $effect(() => {
    area = initialArea;
  });

  const areas = $derived([...new Set(data.units.map((u) => u.area))].sort());
  const kinds = $derived([...new Set(data.units.map((u) => u.kind))].sort());
  const visible = $derived(filterUnits(data.units, { query, area, kind }));
  const current = $derived(data.units.find((u) => u.uid === selected) ?? visible[0]);
</script>

<div class="layout">
  <aside>
    <div class="filters">
      <label class="sr-only" for="unit-search">Search units</label>
      <input id="unit-search" type="search" placeholder="Search names, files, docs, rationale…" bind:value={query} />
      <div class="row">
        <label class="sr-only" for="unit-area">Area</label>
        <select id="unit-area" bind:value={area}>
          <option value="">All areas</option>
          {#each areas as a (a)}<option value={a}>{a}</option>{/each}
        </select>
        <label class="sr-only" for="unit-kind">Kind</label>
        <select id="unit-kind" bind:value={kind}>
          <option value="">All kinds</option>
          {#each kinds as k (k)}<option value={k}>{k}</option>{/each}
        </select>
      </div>
      <p class="count muted">{visible.length} of {data.units.length} units</p>
    </div>
    <ul class="list">
      {#each visible as unit (unit.uid)}
        <li>
          <a href={`#/units/${unit.uid}`} aria-current={current?.uid === unit.uid ? "true" : undefined}>
            <span class="name">{unit.name}</span>
            <span class="meta">
              <span class="kind">{unit.kind}</span>
              {#if unit.versions.length > 1}<span class="chip accent">v{unit.versions.length}</span>{/if}
            </span>
            <span class="file">{unit.location.file}</span>
          </a>
        </li>
      {:else}
        <li class="muted empty">No units match.</li>
      {/each}
    </ul>
  </aside>

  <section class="detail">
    {#if current}
      {#key current.uid}
        <UnitDetail {data} unit={current} />
      {/key}
    {/if}
  </section>
</div>

<style>
  .layout {
    display: grid;
    grid-template-columns: 340px minmax(0, 1fr);
    gap: 24px;
    align-items: start;
  }

  aside {
    position: sticky;
    top: 78px;
    max-height: calc(100vh - 100px);
    display: flex;
    flex-direction: column;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    overflow: hidden;
  }

  .filters {
    padding: 12px;
    border-bottom: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .row {
    display: flex;
    gap: 8px;
  }

  .count {
    margin: 0;
    font-size: 12px;
  }

  .list {
    list-style: none;
    margin: 0;
    padding: 6px;
    overflow-y: auto;
  }

  .list a {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0 8px;
    padding: 8px 10px;
    border-radius: 7px;
    color: var(--text);
  }

  .list a:hover {
    background: var(--surface-2);
    text-decoration: none;
  }

  .list a[aria-current="true"] {
    background: var(--accent-soft);
  }

  .name {
    font-family: var(--mono);
    font-size: 13.5px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .meta {
    display: flex;
    gap: 6px;
    align-items: center;
  }

  .kind {
    font-size: 12px;
    color: var(--muted);
  }

  .file {
    grid-column: 1 / -1;
    font-size: 12px;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .empty {
    padding: 12px;
  }

  @media (max-width: 860px) {
    .layout {
      grid-template-columns: minmax(0, 1fr);
    }

    aside {
      position: static;
      max-height: 380px;
    }
  }
</style>
