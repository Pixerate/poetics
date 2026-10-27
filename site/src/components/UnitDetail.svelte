<script lang="ts">
  import Text from "./Text.svelte";
  import { isStaleFor, linkHref, linkLabel, notesForUnit, sourceUrl } from "../lib/query.ts";
  import type { SiteData, SiteUnit } from "../lib/types.ts";

  let { data, unit }: { data: SiteData; unit: SiteUnit } = $props();

  const latest = $derived(unit.versions.at(-1)!);
  const notes = $derived(notesForUnit(data.notes, unit));
  const owner = $derived(unit.owner ? data.units.find((u) => u.uid === unit.owner) : undefined);
  const dependents = $derived(data.units.filter((u) => Object.hasOwn(u.versions.at(-1)?.deps ?? {}, unit.uid)));
  const record = $derived.by(() => {
    const { area: _area, source: _source, startLine: _startLine, ...stored } = unit;
    return JSON.stringify(stored, null, 2);
  });
  const timeline = $derived([...unit.versions].reverse());
</script>

<article>
  <header>
    <div class="chips">
      <span class="chip accent">{unit.kind}</span>
      <span class="chip">{unit.area}</span>
      {#if latest.provisional}<span class="chip" title="Hashes are git blob hashes until the indexer lands">provisional hash</span>{/if}
      {#if (unit.tests?.length ?? 0) > 0}
        <span class="chip good">{unit.tests!.length} linked test{unit.tests!.length === 1 ? "" : "s"}</span>
      {:else}
        <span class="chip warn">no linked tests</span>
      {/if}
    </div>
    <h1><code>{unit.name}</code></h1>
    <p class="where">
      <a href={sourceUrl(data.repo, unit.location.file, unit.startLine)}>{unit.location.file}{unit.startLine ? `:${unit.startLine}` : ""}</a>
      · <span class="uid" title="Stable id: survives renames and moves">{unit.uid}</span>
    </p>
    {#if unit.docs}<p class="docs">{unit.docs}</p>{/if}
    {#if owner}<p class="muted">Owned by <a href={`#/units/${owner.uid}`}>{owner.name}</a></p>{/if}
  </header>

  {#if notes.length > 0}
    <section class="notes">
      <h2>Known gotchas</h2>
      {#each notes as note (note.id)}
        <div class="note">
          <div class="note-title">
            <strong><Text text={note.title} /></strong>
            {#if isStaleFor(note, unit)}<span class="chip warn">unit changed since confirmed</span>{/if}
          </div>
          <p><span class="muted">Fix:</span> <Text text={note.fix} /></p>
        </div>
      {/each}
    </section>
  {/if}

  <section>
    <h2>History <span class="muted count">{unit.versions.length} version{unit.versions.length === 1 ? "" : "s"}</span></h2>
    <ol class="timeline">
      {#each timeline as version, i (version.contentHash)}
        <li>
          <div class="dot" class:first={i === 0}></div>
          <div class="body">
            <div class="line">
              <span class={`chip ${version.change === "interface" ? "warn" : version.change === "created" ? "good" : "accent"}`}>{version.change}</span>
              <span class="actor">
                {#if version.actor.kind === "agent"}
                  {version.actor.tool}{version.actor.model ? ` · ${version.actor.model}` : ""}
                  {#if !version.actor.reviewed}<span class="chip">unreviewed</span>{/if}
                {:else}
                  human
                {/if}
              </span>
              <code class="hash" title={version.contentHash}>{version.contentHash.slice(0, 12)}</code>
            </div>
            <p><Text text={version.rationale} /></p>
            {#if version.links?.length}
              <div class="links">
                {#each version.links as link, j (j)}
                  {@const href = linkHref(link, data.repo)}
                  {#if href}<a {href}>{linkLabel(link)}</a>{:else}<span>{linkLabel(link)}</span>{/if}
                {/each}
              </div>
            {/if}
          </div>
        </li>
      {/each}
    </ol>
  </section>

  {#if unit.source}
    <section class="source">
      <h2>Current source</h2>
      <pre><code>{unit.source}</code></pre>
    </section>
  {/if}

  {#if unit.lineage?.length}
    <section>
      <h2>Lineage</h2>
      <ul>
        {#each unit.lineage as entry, i (i)}
          <li><span class="chip">{entry.kind}</span> {entry.from ? `from ${entry.from}` : ""}</li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if unit.tests?.length || dependents.length}
    <section class="split">
      {#if unit.tests?.length}
        <div>
          <h2>Tests</h2>
          <ul>
            {#each unit.tests as test (test.file + (test.name ?? ""))}
              <li><a href={sourceUrl(data.repo, test.file)}>{test.file}</a> <span class="muted">({test.via})</span></li>
            {/each}
          </ul>
        </div>
      {/if}
      {#if dependents.length}
        <div>
          <h2>Used by</h2>
          <ul>
            {#each dependents as d (d.uid)}<li><a href={`#/units/${d.uid}`}>{d.name}</a></li>{/each}
          </ul>
        </div>
      {/if}
    </section>
  {/if}

  <details>
    <summary>What an agent reads: <code>.poetics/units/{unit.uid}.json</code></summary>
    <pre><code>{record}</code></pre>
  </details>
</article>

<style>
  article {
    min-width: 0;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 10px;
  }

  h1 {
    margin: 0 0 6px;
    font-size: 28px;
  }

  h1 code {
    background: none;
    border: 0;
    padding: 0;
    font-size: 0.9em;
    word-break: break-word;
  }

  .where {
    margin: 0 0 12px;
    font-size: 14px;
    word-break: break-all;
  }

  .uid {
    font-family: var(--mono);
    font-size: 12.5px;
    color: var(--muted);
  }

  .docs {
    font-size: 16px;
    margin: 0 0 8px;
  }

  section {
    margin-top: 26px;
  }

  h2 {
    font-size: 18px;
    margin: 0 0 10px;
  }

  .count {
    font-family: var(--sans);
    font-size: 13px;
    font-weight: 400;
  }

  .notes .note {
    border: 1px solid var(--warn-soft);
    background: var(--warn-soft);
    border-radius: var(--radius);
    padding: 10px 14px;
    margin-bottom: 8px;
  }

  .note-title {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
  }

  .note p {
    margin: 4px 0 0;
  }

  .timeline {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .timeline li {
    display: grid;
    grid-template-columns: 18px 1fr;
    gap: 10px;
    position: relative;
    padding-bottom: 16px;
  }

  .timeline li:not(:last-child)::before {
    content: "";
    position: absolute;
    left: 6px;
    top: 16px;
    bottom: 0;
    width: 2px;
    background: var(--border);
  }

  .dot {
    width: 14px;
    height: 14px;
    margin-top: 4px;
    border-radius: 50%;
    border: 2px solid var(--accent);
    background: var(--bg);
  }

  .dot.first {
    background: var(--accent);
  }

  .line {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    font-size: 13px;
  }

  .actor {
    color: var(--muted);
    display: inline-flex;
    gap: 6px;
    align-items: center;
  }

  .hash {
    margin-left: auto;
    font-size: 11.5px;
    color: var(--muted);
  }

  .body p {
    margin: 6px 0;
  }

  .links {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    font-size: 13px;
  }

  ul {
    padding-left: 18px;
    margin: 0;
  }

  li {
    margin-bottom: 4px;
  }

  .split {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 20px;
  }

  details {
    margin-top: 28px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
  }

  summary {
    cursor: pointer;
    padding: 12px 16px;
    font-weight: 500;
    overflow-wrap: anywhere;
  }

  .source pre {
    max-height: 420px;
  }

  details pre {
    border: 0;
    border-top: 1px solid var(--border);
    border-radius: 0 0 var(--radius) var(--radius);
    max-height: 480px;
  }
</style>
