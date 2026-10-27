<script lang="ts">
  import { onMount } from "svelte";
  import Overview from "./components/Overview.svelte";
  import Units from "./components/Units.svelte";
  import Notes from "./components/Notes.svelte";
  import type { SiteData } from "./lib/types.ts";

  let data = $state<SiteData | undefined>();
  let error = $state<string | undefined>();
  let hash = $state(location.hash);

  const route = $derived.by(() => {
    const [path = "", query = ""] = hash.replace(/^#/, "").split("?");
    const [, page = "", id] = path.split("/");
    return { page, id, params: new URLSearchParams(query) };
  });

  onMount(() => {
    const onHash = () => {
      hash = location.hash;
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onHash);
    fetch("./data.json")
      .then((response) => {
        if (!response.ok) throw new Error(`data.json: HTTP ${response.status}`);
        return response.json() as Promise<SiteData>;
      })
      .then((loaded) => (data = loaded))
      .catch((cause: Error) => (error = cause.message));
    return () => window.removeEventListener("hashchange", onHash);
  });

  const nav = [
    { page: "", label: "Overview" },
    { page: "units", label: "Units" },
    { page: "notes", label: "Gotchas" },
  ];
</script>

<header>
  <div class="inner">
    <a class="brand" href="#/">
      <span class="logo" aria-hidden="true">P</span>
      <span>Poetics <span class="muted">on Poetics</span></span>
    </a>
    <nav aria-label="Sections">
      {#each nav as item (item.page)}
        <a href={`#/${item.page}`} aria-current={route.page === item.page ? "page" : undefined}>{item.label}</a>
      {/each}
      <a href="https://github.com/Pixerate/poetics" class="gh">GitHub</a>
    </nav>
  </div>
</header>

<main>
  {#if error}
    <div class="card status">Could not load the data: {error}</div>
  {:else if !data}
    <div class="status muted">Loading the codebase…</div>
  {:else if route.page === "units"}
    <Units {data} selected={route.id} initialArea={route.params.get("area") ?? ""} />
  {:else if route.page === "notes"}
    <Notes {data} />
  {:else}
    <Overview {data} />
  {/if}
</main>

{#if data}
  <footer>
    Generated from
    <a href={`${data.repo.url}/commit/${data.repo.commit}`}><code>{data.repo.commit.slice(0, 7)}</code></a>
    on {new Date(data.generatedAt).toLocaleString()} · Everything here is read from the repository's own
    <code>.poetics/</code> folder.
  </footer>
{/if}

<style>
  header {
    position: sticky;
    top: 0;
    z-index: 10;
    background: color-mix(in srgb, var(--bg) 88%, transparent);
    backdrop-filter: blur(8px);
    border-bottom: 1px solid var(--border);
  }

  .inner,
  main,
  footer {
    max-width: 1180px;
    margin: 0 auto;
    padding-inline: 20px;
  }

  .inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    height: 58px;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    color: var(--text);
    font-family: var(--serif);
    font-size: 18px;
    font-weight: 600;
  }

  .brand:hover {
    text-decoration: none;
  }

  .logo {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 7px;
    background: #4338ca;
    color: white;
    font-size: 16px;
  }

  nav {
    display: flex;
    gap: 4px;
    overflow-x: auto;
  }

  nav a {
    color: var(--muted);
    padding: 6px 10px;
    border-radius: 7px;
    font-weight: 500;
    white-space: nowrap;
  }

  nav a:hover {
    color: var(--text);
    background: var(--surface-2);
    text-decoration: none;
  }

  nav a[aria-current="page"] {
    color: var(--text);
    background: var(--surface-2);
  }

  main {
    padding-block: 28px 48px;
    min-height: 70vh;
  }

  .status {
    margin-top: 60px;
    text-align: center;
  }

  footer {
    padding-block: 24px 40px;
    border-top: 1px solid var(--border);
    color: var(--muted);
    font-size: 13px;
  }

  @media (max-width: 560px) {
    .brand .muted,
    .gh {
      display: none;
    }
  }
</style>
