<script lang="ts">
  import Text from "./Text.svelte";
  import { linkHref, linkLabel, matchNotes } from "../lib/query.ts";
  import type { SiteData } from "../lib/types.ts";

  let { data }: { data: SiteData } = $props();

  let pasted = $state("");
  let kind = $state("");

  const examples = ["Removing node_modules", "ERR_MODULE_NOT_FOUND", "strict mode: required property \"resolvedBy\" is not defined"];
  const matches = $derived(matchNotes(data.notes, pasted));
  const active = $derived(data.notes.filter((n) => n.status === "active" && (!kind || n.kind === kind)));
  const retired = $derived(data.notes.filter((n) => n.status !== "active"));
  const areas = $derived([...new Set(active.map((n) => n.area))]);
  const unitName = (uid: string) => data.units.find((u) => u.uid === uid)?.name ?? uid;
</script>

<section class="intro">
  <h1>Gotchas, as data</h1>
  <p class="muted">
    Instead of one long <code>GOTCHAS.md</code>, each pitfall is a note in <code>.poetics/notes/</code> with the exact
    symptom, the cause, the fix, and anchors to the code, files, dependencies and commands it is about. That lets a
    tool match an error to its fix, and flag a note when the code it describes changes.
  </p>
</section>

<section class="lookup card">
  <label for="paste"><strong>Paste an error, a log line or a command</strong></label>
  <textarea id="paste" rows="3" placeholder="e.g. ERR_MODULE_NOT_FOUND" bind:value={pasted}></textarea>
  <div class="examples">
    <span class="muted">Try:</span>
    {#each examples as example (example)}
      <button type="button" onclick={() => (pasted = example)}><code>{example}</code></button>
    {/each}
  </div>
  {#if pasted.trim()}
    {#if matches.length === 0}
      <p class="muted">No matching note. If this cost you time, it might deserve one.</p>
    {:else}
      <ol class="matches">
        {#each matches as match (match.note.id)}
          <li>
            <div class="match-head">
              <strong><Text text={match.note.title} /></strong>
              <span class={`chip ${match.score === 3 ? "good" : match.score === 2 ? "accent" : ""}`}>matched {match.reason}</span>
            </div>
            <p><span class="muted">Fix:</span> <Text text={match.note.fix} /></p>
          </li>
        {/each}
      </ol>
    {/if}
  {/if}
  <p class="aside muted">
    This lookup runs in your browser over the notes below. The planned <code>poetics_notes</code> MCP tool does the
    same for agents, and a hook can run it automatically when a command fails.
  </p>
</section>

<div class="toolbar">
  <h2>{active.length} active notes</h2>
  <label class="sr-only" for="note-kind">Kind</label>
  <select id="note-kind" bind:value={kind}>
    <option value="">All kinds</option>
    <option value="gotcha">Gotchas</option>
    <option value="workaround">Workarounds</option>
    <option value="invariant">Invariants</option>
  </select>
</div>

{#each areas as area (area)}
  <section class="area">
    <h3>{area}</h3>
    <div class="cards">
      {#each active.filter((n) => n.area === area) as note (note.id)}
        <article class="card note">
          <div class="note-head">
            <h4><Text text={note.title} /></h4>
            {#if note.kind !== "gotcha"}<span class="chip warn">{note.kind}</span>{/if}
          </div>
          {#if note.symptoms.length}
            <p class="symptoms">{#each note.symptoms as s (s)}<code>{s}</code>{/each}</p>
          {/if}
          <dl>
            <dt>Cause</dt>
            <dd><Text text={note.cause} /></dd>
            <dt>Fix</dt>
            <dd><Text text={note.fix} /></dd>
          </dl>
          <div class="anchors">
            {#each note.anchors.commands ?? [] as c (c)}<span class="chip">$ {c}</span>{/each}
            {#each note.anchors.dependencies ?? [] as d (d.name)}<span class="chip">{d.name}{d.range ? `@${d.range}` : ""}</span>{/each}
            {#each note.anchors.paths ?? [] as p (p)}<span class="chip">{p}</span>{/each}
            {#each note.anchors.units ?? [] as u (u.uid)}<a class="chip accent" href={`#/units/${u.uid}`}>{unitName(u.uid)}</a>{/each}
          </div>
          <div class="foot">
            {#if note.check}
              <span class="chip good" title={note.check.name ?? note.check.ref}>caught by {note.check.kind}</span>
            {:else}
              <span class="chip">no automated check yet</span>
            {/if}
            {#each note.links ?? [] as link, i (i)}
              {@const href = linkHref(link, data.repo)}
              {#if href}<a {href}>{linkLabel(link)}</a>{/if}
            {/each}
          </div>
        </article>
      {/each}
    </div>
  </section>
{/each}

{#if retired.length}
  <section>
    <h2>Retired</h2>
    <ul>
      {#each retired as note (note.id)}<li><Text text={note.title} /> <span class="chip">{note.status}</span></li>{/each}
    </ul>
  </section>
{/if}

<style>
  .intro {
    max-width: 780px;
  }

  h1 {
    font-size: 34px;
    margin: 0 0 10px;
  }

  .lookup {
    margin: 22px 0 34px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    max-width: 860px;
  }

  textarea {
    font-family: var(--mono);
    font-size: 13.5px;
    resize: vertical;
  }

  .examples {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
    font-size: 13px;
  }

  .examples button {
    background: none;
    border: 0;
    padding: 0;
    cursor: pointer;
  }

  .examples button:hover code {
    border-color: var(--accent);
  }

  .matches {
    margin: 4px 0 0;
    padding-left: 20px;
  }

  .matches li {
    margin-bottom: 10px;
  }

  .match-head {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }

  .matches p {
    margin: 4px 0 0;
  }

  .aside {
    font-size: 13px;
    margin: 4px 0 0;
  }

  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .toolbar select {
    width: auto;
  }

  h2 {
    font-size: 24px;
    margin: 0;
  }

  .area {
    margin-top: 22px;
  }

  h3 {
    font-family: var(--sans);
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
    margin: 0 0 10px;
  }

  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
    gap: 12px;
  }

  .note {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .note-head {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    align-items: start;
  }

  h4 {
    margin: 0;
    font-size: 16px;
    font-family: var(--serif);
  }

  .symptoms {
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  dl {
    margin: 0;
    font-size: 14px;
  }

  dt {
    font-weight: 600;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
  }

  dd {
    margin: 0 0 6px;
  }

  .anchors,
  .foot {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
    font-size: 13px;
  }

  .foot {
    margin-top: auto;
    padding-top: 6px;
    border-top: 1px solid var(--border);
  }

  @media (max-width: 420px) {
    .cards {
      grid-template-columns: 1fr;
    }
  }
</style>
