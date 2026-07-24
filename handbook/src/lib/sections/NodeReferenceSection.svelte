<script>
  // Searchable Node Reference (Appendix E).
  //
  // Structure (inputs / params / outputs / family / demo link) comes from a
  // machine-readable manifest generated straight from the live AnCiR registry
  // (AnCiR static/nodes.json, produced by GEN_MANIFEST). The handbook lives in
  // the same workspace as AnCiR and imports that manifest directly via the
  // $ancir alias, so it is always in step with the app it documents and is
  // inlined into the built page (no runtime fetch).
  //
  // Curated prose (description, maths, academic references, cross-links to the
  // handbook chapters) lives alongside in nodeReference.json and is merged by id.
  import Formula from "$lib/components/Formula.svelte";
  import DemoLink from "$lib/components/DemoLink.svelte";
  import nodeRef from "$lib/nodeReference.json";
  import manifest from "$ancir/static/nodes.json";

  // Human-facing labels + ordering for the node kinds.
  const KIND_META = {
    tableProcess: { label: "Analysis", order: 0 },
    process: { label: "Column process", order: 1 },
    plot: { label: "Plot", order: 2 }
  };
  const kindLabel = (k) => KIND_META[k]?.label ?? k;

  const CHAPTER_TITLES = {
    ch1: "1. Introduction",
    ch2: "2. Data Collection",
    ch3: "3. Simulating Data",
    ch4: "4. Preprocessing",
    ch5: "5. Actograms",
    ch6: "6. Periodograms",
    ch7: "7. Cosinor Analysis",
    ch8: "8. Fourier Analysis",
    ch9: "9. Correlograms",
    ch10: "10. Phase Response Curves",
    ch11: "11. Linear & Additive Models",
    ch12: "12. Circular Statistics",
    ch13: "13. Best Practices",
    glossary: "Glossary"
  };

  let query = $state("");
  let kindFilter = $state("all");
  let openId = $state(null);

  // Merge the bundled manifest (structure) with the curated prose (by id).
  const nodes = (manifest.nodes ?? [])
    .filter((n) => !n.hideFromPalette)
    .map((n) => {
      const c = nodeRef[n.id] ?? {};
      return {
        ...n,
        // Prefer curated prose; fall back to the registry's short blurb.
        description: c.description ?? n.description ?? "",
        maths: c.maths ?? [],
        references: c.references ?? [],
        crosslinks: c.crosslinks ?? []
      };
    })
    .sort(
      (a, b) =>
        (KIND_META[a.kind]?.order ?? 9) - (KIND_META[b.kind]?.order ?? 9) ||
        a.displayName.localeCompare(b.displayName)
    );

  const kinds = $derived([
    "all",
    ...Array.from(new Set(nodes.map((n) => n.kind))).sort(
      (a, b) => (KIND_META[a]?.order ?? 9) - (KIND_META[b]?.order ?? 9)
    )
  ]);

  const counts = $derived(
    nodes.reduce((m, n) => ((m[n.kind] = (m[n.kind] ?? 0) + 1), m), {})
  );

  const filtered = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return nodes.filter((n) => {
      if (kindFilter !== "all" && n.kind !== kindFilter) return false;
      if (!q) return true;
      const hay = `${n.displayName} ${n.id} ${n.family} ${n.description}`.toLowerCase();
      return hay.includes(q);
    });
  });

  function toggle(id) {
    openId = openId === id ? null : id;
  }

  const portLabel = (p) => {
    const bits = [p.name];
    if (p.cardinality === "many") bits.push("(many)");
    if (p.metric) bits.push("• metric");
    return bits.join(" ");
  };
</script>

<section id="node-reference">
  <h2 class="chapter-title">
    <span class="chapter-num">Appendix D</span>
    Node Reference
  </h2>

  <p class="lede">
    Every node available in AnCiR, generated directly from the application so it
    stays in step with the software. Search by name or description, filter by
    kind, and open any node to see its inputs, parameters, outputs, the
    method it implements (with equations and references), and a one-click link to
    a worked example that opens straight in AnCiR.
  </p>

    <div class="controls">
      <input
        class="search"
        type="search"
        placeholder="Search {nodes.length} nodes…"
        bind:value={query}
        aria-label="Search nodes"
      />
      <div class="kind-tabs" role="tablist" aria-label="Filter by node kind">
        {#each kinds as k}
          <button
            type="button"
            role="tab"
            aria-selected={kindFilter === k}
            class="kind-tab"
            class:active={kindFilter === k}
            onclick={() => (kindFilter = k)}
          >
            {k === "all" ? "All" : kindLabel(k)}
            <span class="tab-count">{k === "all" ? nodes.length : counts[k] ?? 0}</span>
          </button>
        {/each}
      </div>
    </div>

    <p class="result-count">
      {filtered.length} node{filtered.length === 1 ? "" : "s"}
      {query ? `matching “${query}”` : ""}
    </p>

    <div class="node-list">
      {#each filtered as n (n.id)}
        <article class="node-card" class:open={openId === n.id}>
          <button
            type="button"
            class="node-head"
            aria-expanded={openId === n.id}
            onclick={() => toggle(n.id)}
          >
            <span class="node-name">{n.displayName}</span>
            <span class="node-kind kind-{n.kind}">{kindLabel(n.kind)}</span>
            {#if n.family && n.family !== "Other" && n.family !== "Plots"}
              <span class="node-family">{n.family}</span>
            {/if}
            <span class="chevron" aria-hidden="true">{openId === n.id ? "−" : "+"}</span>
          </button>

          {#if openId === n.id}
            <div class="node-body">
              {#if n.description}
                {#each n.description.split(/\n\n+/) as para}
                  <p>{para}</p>
                {/each}
              {/if}

              <div class="ports">
                <div class="port-col">
                  <h4>Inputs</h4>
                  {#if n.inputs?.length}
                    <ul>
                      {#each n.inputs as p}<li>{portLabel(p)}</li>{/each}
                    </ul>
                  {:else}
                    <p class="muted">None</p>
                  {/if}
                </div>
                <div class="port-col">
                  <h4>Parameters</h4>
                  {#if n.params?.length}
                    <ul>
                      {#each n.params as p}
                        <li>
                          <code>{p.name}</code>{#if p.default !== undefined && p.default !== null && p.default !== ""}
                            <span class="muted"> = {String(p.default)}</span>{/if}
                        </li>
                      {/each}
                    </ul>
                  {:else}
                    <p class="muted">None</p>
                  {/if}
                </div>
                <div class="port-col">
                  <h4>Outputs</h4>
                  {#if n.outputs?.length}
                    <ul>
                      {#each n.outputs as p}<li>{portLabel(p)}</li>{/each}
                    </ul>
                  {:else}
                    <p class="muted">{n.kind === "plot" ? "Renders a plot" : "None"}</p>
                  {/if}
                </div>
              </div>

              {#if n.maths?.length}
                <div class="maths">
                  <h4>Method</h4>
                  {#each n.maths as m}
                    <Formula tex={m} />
                  {/each}
                </div>
              {/if}

              {#if n.crosslinks?.length}
                <div class="crosslinks">
                  <h4>See also</h4>
                  {#each n.crosslinks as cl}
                    <a class="crosslink" href="#{cl}">{CHAPTER_TITLES[cl] ?? cl}</a>
                  {/each}
                </div>
              {/if}

              {#if n.references?.length}
                <div class="refs">
                  <h4>References</h4>
                  <ul>
                    {#each n.references as r}
                      <li>
                        {r.cite}{#if r.doi}
                          <a
                            class="doi"
                            href={r.doi.startsWith("http") ? r.doi : `https://doi.org/${r.doi}`}
                            target="_blank"
                            rel="noopener noreferrer">doi:{r.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//, "")}</a
                          >{/if}
                      </li>
                    {/each}
                  </ul>
                </div>
              {/if}

              {#if n.demo}
                <DemoLink session={n.demo} label="Open the {n.displayName} example in AnCiR" />
              {:else}
                <p class="muted no-demo">No worked example is bundled for this node yet.</p>
              {/if}
            </div>
          {/if}
        </article>
      {/each}
      {#if filtered.length === 0}
        <p class="status">No nodes match your search.</p>
      {/if}
    </div>
</section>

<style>
  .lede {
    max-width: 60ch;
    color: var(--text-muted, #555);
  }
  .status {
    padding: 1rem 0;
    color: var(--text-muted, #666);
  }
  .status-error {
    color: #b4402f;
  }
  .controls {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: center;
    margin: 18px 0 6px;
    position: sticky;
    top: 0;
    background: var(--bg, #fff);
    padding: 10px 0;
    z-index: 2;
  }
  .search {
    flex: 1 1 260px;
    min-width: 200px;
    padding: 9px 12px;
    font-size: 0.95rem;
    border: 1px solid var(--border, #d5d5d5);
    border-radius: 8px;
    background: var(--surface, #fff);
    color: inherit;
  }
  .search:focus {
    outline: 2px solid var(--blue, #3e7295);
    outline-offset: 1px;
  }
  .kind-tabs {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .kind-tab {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 12px;
    font-size: 0.82rem;
    font-weight: 600;
    border: 1px solid var(--border, #d5d5d5);
    border-radius: 999px;
    background: var(--surface, #fafafa);
    color: var(--text-muted, #555);
    cursor: pointer;
    transition: background 0.12s, color 0.12s, border-color 0.12s;
  }
  .kind-tab:hover {
    border-color: var(--blue, #3e7295);
  }
  .kind-tab.active {
    background: var(--blue, #3e7295);
    border-color: var(--blue, #3e7295);
    color: #fff;
  }
  .tab-count {
    font-size: 0.72rem;
    opacity: 0.8;
    background: rgba(0, 0, 0, 0.12);
    border-radius: 999px;
    padding: 1px 6px;
  }
  .kind-tab.active .tab-count {
    background: rgba(255, 255, 255, 0.25);
  }
  .result-count {
    font-size: 0.8rem;
    color: var(--text-muted, #777);
    margin: 4px 0 12px;
  }
  .node-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .node-card {
    border: 1px solid var(--border, #e0e0e0);
    border-radius: 10px;
    overflow: hidden;
    background: var(--surface, #fff);
  }
  .node-card.open {
    border-color: var(--blue, #3e7295);
    box-shadow: 0 2px 10px rgba(62, 114, 149, 0.12);
  }
  .node-head {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
    font: inherit;
    color: inherit;
  }
  .node-head:hover {
    background: var(--surface-hover, #f6f8fa);
  }
  .node-name {
    font-weight: 600;
    font-size: 1rem;
  }
  .node-kind {
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    padding: 2px 8px;
    border-radius: 999px;
    color: #fff;
  }
  .kind-tableProcess {
    background: #3e7295;
  }
  .kind-process {
    background: #6a8f4f;
  }
  .kind-plot {
    background: #9a6a3e;
  }
  .node-family {
    font-size: 0.74rem;
    color: var(--text-muted, #888);
  }
  .chevron {
    margin-left: auto;
    font-size: 1.2rem;
    color: var(--text-muted, #999);
    width: 1ch;
    text-align: center;
  }
  .node-body {
    padding: 4px 16px 18px;
    border-top: 1px solid var(--border, #eee);
  }
  .node-body p {
    max-width: 68ch;
    line-height: 1.6;
  }
  .ports {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 14px;
    margin: 14px 0;
    padding: 12px;
    background: var(--surface-sunken, #f7f8fa);
    border-radius: 8px;
  }
  .port-col h4 {
    margin: 0 0 6px;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted, #888);
  }
  .port-col ul {
    margin: 0;
    padding-left: 1.1em;
    font-size: 0.86rem;
    line-height: 1.5;
  }
  .port-col code {
    font-size: 0.82rem;
  }
  .muted {
    color: var(--text-muted, #999);
    font-size: 0.86rem;
  }
  .maths,
  .refs,
  .crosslinks {
    margin-top: 16px;
  }
  .maths h4,
  .refs h4,
  .crosslinks h4 {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted, #888);
    margin: 0 0 8px;
  }
  .refs ul {
    margin: 0;
    padding-left: 1.2em;
    font-size: 0.85rem;
    line-height: 1.55;
    color: var(--text-muted, #444);
  }
  .refs li {
    margin-bottom: 5px;
  }
  .doi {
    margin-left: 6px;
    font-size: 0.8rem;
  }
  .crosslink {
    display: inline-block;
    margin: 0 8px 6px 0;
    padding: 4px 10px;
    font-size: 0.8rem;
    border: 1px solid var(--blue, #3e7295);
    border-radius: 999px;
    color: var(--blue, #3e7295);
    text-decoration: none;
  }
  .crosslink:hover {
    background: var(--blue, #3e7295);
    color: #fff;
  }
  .no-demo {
    margin-top: 14px;
  }
</style>
