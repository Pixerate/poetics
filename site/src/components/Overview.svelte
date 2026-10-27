<script lang="ts">
  import Meter from "./Meter.svelte";
  import Text from "./Text.svelte";
  import { percent, sourceUrl } from "../lib/query.ts";
  import type { MetricName, SiteData } from "../lib/types.ts";

  let { data }: { data: SiteData } = $props();

  const metrics: Array<{ name: MetricName; label: string; hint: string }> = [
    { name: "tracked", label: "Tracked", hint: "exports with a unit" },
    { name: "fresh", label: "Fresh", hint: "units matching their code" },
    { name: "linkedRationale", label: "Cited", hint: "versions citing a source" },
    { name: "tested", label: "Tested", hint: "units with linked tests" },
    { name: "documented", label: "Documented", hint: "units with docs" },
    { name: "reviewed", label: "Reviewed", hint: "agent versions a human approved" },
  ];

  const versions = $derived(data.units.reduce((sum, unit) => sum + unit.versions.length, 0));
  const agentShare = $derived(
    data.units.flatMap((u) => u.versions).filter((v) => v.actor.kind === "agent").length / Math.max(versions, 1),
  );
  const areas = $derived(Object.entries(data.coverage.byArea));
  const recent = $derived(
    data.units
      .flatMap((unit) => unit.versions.map((version, index) => ({ unit, version, index })))
      .filter(({ index }) => index > 0)
      .slice(-6)
      .reverse(),
  );
</script>

<section class="hero">
  <p class="eyebrow">An open-source framework, run on itself</p>
  <h1>Every function and type in Poetics, with its history, reasons, tests and gotchas.</h1>
  <p class="lede">
    Poetics treats each function, hook, component and type as a versioned unit that carries why it exists and how it
    changed. Coding agents read and write that record as they work. This page is generated from the Poetics repository's
    own <code>.poetics/</code> folder at commit
    <a href={`${data.repo.url}/commit/${data.repo.commit}`}><code>{data.repo.commit.slice(0, 7)}</code></a>.
  </p>
  <blockquote>“The idea becomes a machine that makes the art.” <cite>Sol LeWitt, 1967</cite></blockquote>
  <div class="ctas">
    <a class="button primary" href="#/units">Browse {data.units.length} units</a>
    <a class="button" href="#/notes">Look up an error</a>
  </div>
</section>

<section class="stats">
  <div><strong>{data.units.length}</strong><span>units</span></div>
  <div><strong>{versions}</strong><span>recorded versions</span></div>
  <div><strong>{percent(agentShare)}</strong><span>written by agents</span></div>
  <div><strong>{data.coverage.notes.active}</strong><span>active gotchas</span></div>
  <div><strong>{data.decisions.length}</strong><span>decision records</span></div>
</section>

<section>
  <h2>Coverage</h2>
  <p class="muted section-lede">
    From <code>pnpm poetics:coverage</code>. Pull requests fail when a figure drops below its minimum, and
    <code>pnpm poetics:check</code> fails any change that edits code without recording it here.
  </p>
  <div class="grid">
    {#each metrics as metric (metric.name)}
      <Meter label={metric.label} hint={metric.hint} value={data.coverage.overall[metric.name]} threshold={data.thresholds[metric.name]} />
    {/each}
  </div>

  <div class="table-wrap card">
    <table>
      <thead>
        <tr>
          <th scope="col">Area</th>
          {#each metrics as metric (metric.name)}<th scope="col">{metric.label}</th>{/each}
        </tr>
      </thead>
      <tbody>
        {#each areas as [area, values] (area)}
          <tr>
            <th scope="row"><a href={`#/units?area=${encodeURIComponent(area)}`}>{area}</a></th>
            {#each metrics as metric (metric.name)}
              <td class:low={values[metric.name].total > 0 && values[metric.name].ratio < 0.5}>
                {values[metric.name].total === 0 ? "—" : percent(values[metric.name].ratio)}
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</section>

<section class="two">
  <div>
    <h2>Recent changes</h2>
    <ul class="changes">
      {#each recent as { unit, version } (`${unit.uid}-${version.contentHash}`)}
        <li>
          <a href={`#/units/${unit.uid}`}><code>{unit.name}</code></a>
          <span class={`chip ${version.change === "interface" ? "warn" : "accent"}`}>{version.change}</span>
          <p><Text text={version.rationale} /></p>
        </li>
      {:else}
        <li class="muted">No changes after creation yet.</li>
      {/each}
    </ul>
  </div>
  <div>
    <h2>Decisions</h2>
    <ul class="decisions">
      {#each data.decisions as decision (decision.id)}
        <li>
          <a href={sourceUrl(data.repo, decision.path)}><span class="num">{decision.id}</span> {decision.title}</a>
          <span class="chip">{decision.status}</span>
        </li>
      {/each}
    </ul>
  </div>
</section>

<section>
  <h2>How this works</h2>
  <ol class="how">
    <li>
      <strong>One JSON file per unit</strong> in <code>.poetics/units/</code>, in git beside the code: a stable id that
      survives renames, and an append-only list of versions with change class, rationale, links and who made it.
    </li>
    <li>
      <strong>Agents follow skills</strong> in <code>.claude/skills/</code> to read that history before a change and to
      record a version after it. Agent-written entries stay unreviewed until a human approves them.
    </li>
    <li>
      <strong>Gotchas are notes</strong> anchored to the code, files, dependencies and commands they are about, so an
      error can be matched to its fix. <code>GOTCHAS.md</code> is generated from them.
    </li>
    <li>
      <strong>Checks keep it honest.</strong> CI validates the store, fails unrecorded changes, and enforces coverage.
    </li>
  </ol>
</section>

<style>
  section {
    margin-bottom: 44px;
  }

  .hero {
    max-width: 820px;
    padding-top: 12px;
  }

  .eyebrow {
    color: var(--accent);
    font-weight: 600;
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin: 0 0 10px;
  }

  h1 {
    font-size: clamp(28px, 4.4vw, 44px);
    margin: 0 0 16px;
  }

  .lede {
    font-size: 17px;
    color: var(--muted);
    margin: 0 0 18px;
  }

  blockquote {
    margin: 0 0 22px;
    padding-left: 14px;
    border-left: 3px solid var(--accent);
    font-family: var(--serif);
    font-style: italic;
    font-size: 17px;
  }

  cite {
    display: block;
    font-style: normal;
    font-family: var(--sans);
    font-size: 13px;
    color: var(--muted);
  }

  .ctas {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }

  .button {
    display: inline-block;
    padding: 9px 16px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    font-weight: 600;
  }

  .button.primary {
    background: #4338ca;
    border-color: #4338ca;
    color: white;
  }

  .button:hover {
    text-decoration: none;
    filter: brightness(1.06);
  }

  .stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
  }

  .stats div {
    padding: 16px 18px;
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
  }

  .stats div:last-child {
    border-right: 0;
  }

  .stats strong {
    font-family: var(--serif);
    font-size: 26px;
  }

  .stats span {
    color: var(--muted);
    font-size: 13px;
  }

  h2 {
    font-size: 24px;
    margin: 0 0 6px;
  }

  .section-lede {
    margin: 0 0 16px;
    max-width: 760px;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 12px;
    margin-bottom: 16px;
  }

  .table-wrap {
    padding: 0;
    overflow-x: auto;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 14px;
  }

  th,
  td {
    text-align: right;
    padding: 9px 14px;
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
  }

  th:first-child {
    text-align: left;
  }

  thead th {
    color: var(--muted);
    font-weight: 500;
    font-size: 13px;
  }

  tbody tr:last-child > * {
    border-bottom: 0;
  }

  tbody th {
    font-weight: 500;
  }

  td.low {
    color: var(--warn);
  }

  .two {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 32px;
  }

  ul {
    list-style: none;
    padding: 0;
    margin: 12px 0 0;
  }

  .changes li {
    padding: 10px 0;
    border-bottom: 1px solid var(--border);
  }

  .changes p {
    margin: 4px 0 0;
    color: var(--muted);
    font-size: 14px;
  }

  .decisions li {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: baseline;
    padding: 9px 0;
    border-bottom: 1px solid var(--border);
  }

  .num {
    font-family: var(--mono);
    color: var(--muted);
    font-size: 13px;
  }

  .how {
    max-width: 820px;
    padding-left: 20px;
  }

  .how li {
    margin-bottom: 10px;
  }

  @media (max-width: 760px) {
    .two {
      grid-template-columns: 1fr;
    }
  }
</style>
