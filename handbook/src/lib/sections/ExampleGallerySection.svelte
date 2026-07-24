<script>
  // Searchable catalogue of every ready-made AnCiR example session, imported
  // directly from AnCiR's session index ($ancir/static/sessions/demos/index.json,
  // datasets filtered out in exampleChapters.js) and inlined into the built page.
  // Mirrors the Node Reference appendix.
  import DemoLink from "$lib/components/DemoLink.svelte";
  import { SESSIONS, chapterScores, CHAPTER_TITLES } from "$lib/exampleChapters.js";

  const KIND_LABEL = {
    workflow: "Workflow",
    tableProcess: "Analysis",
    plot: "Plot",
    process: "Process",
  };
  const KIND_ORDER = { workflow: 0, tableProcess: 1, plot: 2, process: 3 };

  let query = $state("");
  let kindFilter = $state("all");

  const sessions = SESSIONS.map((s) => ({
    ...s,
    chapters: Object.keys(chapterScores(s)).sort(
      (a, b) => Number(a.replace("ch", "")) - Number(b.replace("ch", "")),
    ),
  })).sort(
    (a, b) =>
      (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9) ||
      (a.name ?? "").localeCompare(b.name ?? ""),
  );

  const kinds = ["all", "workflow", "tableProcess", "plot", "process"];
  const counts = sessions.reduce(
    (m, s) => ((m[s.kind] = (m[s.kind] ?? 0) + 1), m),
    {},
  );

  const filtered = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return sessions.filter((s) => {
      if (kindFilter !== "all" && s.kind !== kindFilter) return false;
      if (!q) return true;
      return (s.keywords ?? `${s.name} ${s.summary} ${s.family}`)
        .toLowerCase()
        .includes(q);
    });
  });

  const cleanName = (s) => (s.name ?? s.id ?? "").replace(/^Workflow — /, "");
</script>

<section id="example-gallery">
  <h2 class="chapter-title">
    <span class="chapter-num">Appendix E</span>
    Example Gallery
  </h2>

  <p class="lede">
    Every ready-made session that ships with AnCiR, each one a complete, wired
    workflow you can open on the canvas and take apart. Search by keyword, filter
    by kind, and click <strong>Open in AnCiR</strong> to load a session straight
    from the browser. The chapter chips show where each example is explained. This
    catalogue is bundled with the handbook, so it works offline once this page has
    loaded.
  </p>

  <div class="controls">
    <input
      class="search"
      type="search"
      placeholder="Search {sessions.length} examples…"
      bind:value={query}
      aria-label="Search example sessions"
    />
    <div class="kind-tabs" role="tablist" aria-label="Filter by kind">
      {#each kinds as k}
        <button
          type="button"
          role="tab"
          aria-selected={kindFilter === k}
          class="kind-tab"
          class:active={kindFilter === k}
          onclick={() => (kindFilter = k)}
        >
          {k === "all" ? "All" : KIND_LABEL[k]}
          <span class="tab-count">{k === "all" ? sessions.length : counts[k] ?? 0}</span>
        </button>
      {/each}
    </div>
  </div>

  <p class="result-count">
    {filtered.length} example{filtered.length === 1 ? "" : "s"}
    {query ? `matching “${query}”` : ""}
  </p>

  <div class="gallery-grid">
    {#each filtered as s (s.id)}
      <article class="gallery-card">
        <div class="gc-head">
          <span class="gc-name">{cleanName(s)}</span>
          <span class="gc-kind kind-{s.kind}">{KIND_LABEL[s.kind] ?? s.kind}</span>
        </div>
        {#if s.summary}<p class="gc-summary">{s.summary}</p>{/if}
        {#if s.showcases?.length}
          <div class="gc-nodes">
            {#each s.showcases as n}
              <a class="gc-chip" href="#node-reference">{n}</a>
            {/each}
          </div>
        {/if}
        {#if s.chapters?.length}
          <div class="gc-chapters">
            {#each s.chapters as c}
              <a class="gc-chapter" href="#{c}"
                >{c.replace("ch", "Ch ")}</a
              >
            {/each}
          </div>
        {/if}
        <DemoLink session={s.url} label="Open in AnCiR" />
      </article>
    {/each}
  </div>
</section>

<style>
  #example-gallery {
    scroll-margin-top: var(--header-h);
  }
  .lede {
    color: var(--muted, #556);
    font-size: 0.95rem;
    line-height: 1.6;
    margin-bottom: 1.2rem;
  }
  .controls {
    display: flex;
    flex-wrap: wrap;
    gap: 0.8rem;
    align-items: center;
    margin-bottom: 0.8rem;
  }
  .search {
    flex: 1 1 240px;
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--border, #cbd5e0);
    border-radius: 6px;
    font-size: 0.9rem;
    background: var(--bg, #fff);
    color: var(--text, #1a202c);
  }
  .kind-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }
  .kind-tab {
    padding: 0.4rem 0.7rem;
    border: 1px solid var(--border, #cbd5e0);
    border-radius: 6px;
    background: var(--bg, #fff);
    color: var(--text, #334);
    font-size: 0.82rem;
    cursor: pointer;
  }
  .kind-tab.active {
    background: var(--blue, #3e7295);
    color: #fff;
    border-color: var(--blue, #3e7295);
  }
  .tab-count {
    opacity: 0.7;
    font-size: 0.75em;
    margin-left: 0.25em;
  }
  .result-count {
    font-size: 0.82rem;
    color: var(--muted, #667);
    margin: 0 0 1rem;
  }
  .gallery-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 1rem;
  }
  .gallery-card {
    display: flex;
    flex-direction: column;
    padding: 0.9rem 1rem 1rem;
    border: 1px solid var(--border, #e2e8f0);
    border-radius: 8px;
    background: var(--card-bg, rgba(62, 114, 149, 0.03));
  }
  .gc-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.5rem;
    margin-bottom: 0.35rem;
  }
  .gc-name {
    font-weight: 600;
    font-size: 0.92rem;
    color: var(--text, #1a202c);
  }
  .gc-kind {
    flex: none;
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 0.1rem 0.4rem;
    border-radius: 4px;
    background: rgba(62, 114, 149, 0.12);
    color: var(--blue, #3e7295);
  }
  .gc-kind.kind-workflow {
    background: rgba(217, 119, 6, 0.14);
    color: #b45309;
  }
  .gc-summary {
    font-size: 0.83rem;
    line-height: 1.45;
    color: var(--muted, #556);
    margin: 0 0 0.6rem;
    flex: 1;
  }
  .gc-nodes,
  .gc-chapters {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    margin-bottom: 0.5rem;
  }
  .gc-chip,
  .gc-chapter {
    font-size: 0.72rem;
    padding: 0.12rem 0.4rem;
    border-radius: 4px;
    text-decoration: none;
  }
  .gc-chip {
    background: var(--code-bg, #eef2f7);
    color: var(--text, #445);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .gc-chapter {
    background: transparent;
    border: 1px solid var(--blue, #3e7295);
    color: var(--blue, #3e7295);
  }
  .gc-chip:hover,
  .gc-chapter:hover {
    text-decoration: underline;
  }
</style>
