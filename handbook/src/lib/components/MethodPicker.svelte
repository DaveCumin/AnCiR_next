<script>
  // Three questions -> the methods that survive. Deliberately a FILTER, not a
  // flowchart: goal, study design and sample spacing are independent constraints,
  // so nesting them in a tree would force an arbitrary order and repeat the same
  // leaf (curve fitting) down most branches.
  //
  // Blocked rows are shown, greyed, WITH the reason. Hiding them would answer
  // "which method" while teaching nothing about why the others are out, which is
  // the part readers get wrong.
  import {
    GOALS,
    SAMPLING_OPTIONS,
    SPACING_OPTIONS,
    verdictFor
  } from "$lib/methodGuide.js";

  let goalId = $state("all");
  let sampling = $state("unsure");
  let spacing = $state("unsure");

  const results = $derived(
    GOALS.filter((g) => goalId === "all" || g.id === goalId).map((g) => ({
      ...g,
      verdict: verdictFor(g, sampling, spacing),
    })),
  );

  const usable = $derived(
    results.filter((r) => r.verdict.state !== "blocked").length,
  );
  const touched = $derived(
    goalId !== "all" || sampling !== "unsure" || spacing !== "unsure",
  );

  function reset() {
    goalId = "all";
    sampling = "unsure";
    spacing = "unsure";
  }
</script>

<div class="picker">
  <div class="picker-head">
    <h4>Method picker</h4>
    <p>
      Answer what you can. Anything left as <em>not sure</em> simply doesn't
      filter, so you can start with only the part you know.
    </p>
  </div>

  <div class="controls">
    <label>
      <span>What do you want to find out?</span>
      <select bind:value={goalId}>
        <option value="all">Anything (show all)</option>
        {#each GOALS as g}
          <option value={g.id}
            >{g.goal.replace(/<[^>]+>/g, "")}{g.context
              ? ` (${g.context})`
              : ""}</option
          >
        {/each}
      </select>
    </label>

    <label>
      <span>Your data come from…</span>
      <select bind:value={sampling}>
        {#each SAMPLING_OPTIONS as o}
          <option value={o.value}>{o.label}</option>
        {/each}
      </select>
    </label>

    <label>
      <span>Your samples are…</span>
      <select bind:value={spacing}>
        {#each SPACING_OPTIONS as o}
          <option value={o.value}>{o.label}</option>
        {/each}
      </select>
    </label>
  </div>

  <div class="summary" aria-live="polite">
    {#if !touched}
      <span>All {GOALS.length} questions shown. Narrow them down above.</span>
    {:else if usable === 0}
      <span class="none"
        >No method here answers that question from that kind of data. The
        reasons are below.</span
      >
    {:else}
      <span
        ><strong>{usable}</strong>
        {usable === 1 ? "route" : "routes"} available{results.length > usable
          ? `, ${results.length - usable} ruled out`
          : ""}.</span
      >
    {/if}
    {#if touched}
      <button type="button" class="reset" onclick={reset}>Start over</button>
    {/if}
  </div>

  <ul class="results">
    {#each results as r (r.id)}
      <li class="result {r.verdict.state}">
        <div class="result-head">
          <span class="badge {r.verdict.state}">
            {r.verdict.state === "ok"
              ? "Works"
              : r.verdict.state === "swap"
                ? "Use a variant"
                : "Not possible"}
          </span>
          <span class="q">
            {@html r.goal}{#if r.context}<span class="q-context"
                >{r.context}</span
              >{/if}
          </span>
        </div>
        {#if r.verdict.state !== "blocked"}
          <p class="method">{@html r.method}</p>
        {/if}
        {#if r.verdict.reason}
          <p class="reason">{r.verdict.reason}</p>
        {/if}
        {#if r.verdict.state !== "blocked"}
          <p class="meta">
            <span class="need">Also needs: {r.need}</span>
            <span class="go">
              {#each r.go as [label, id], i}<a href="#{id}">{label}</a>{#if i < r.go.length - 1}<span
                    class="sep">·</span
                  >{/if}{/each}
            </span>
          </p>
        {/if}
      </li>
    {/each}
  </ul>
</div>

<style>
  .picker {
    border: 1px solid var(--border);
    border-top: 3px solid var(--blue);
    border-radius: 8px;
    background: var(--surface);
    padding: 1rem 1.1rem 1.1rem;
    margin: 1.1rem 0;
  }
  .picker-head h4 {
    margin: 0 0 0.25rem;
    font-size: 1rem;
    color: var(--text);
  }
  .picker-head p {
    margin: 0 0 0.9rem;
    font-size: 0.86rem;
    color: var(--muted);
    line-height: 1.5;
  }

  .controls {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(215px, 1fr));
    gap: 0.7rem;
  }
  .controls label {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .controls span {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--text);
  }
  .controls select {
    font: inherit;
    font-size: 0.86rem;
    padding: 0.4rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--text);
  }
  .controls select:focus-visible {
    outline: 2px solid var(--blue);
    outline-offset: 1px;
  }

  .summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    flex-wrap: wrap;
    margin: 0.9rem 0 0.15rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--border);
    font-size: 0.85rem;
    color: var(--muted);
  }
  .summary .none {
    color: var(--red);
  }
  .reset {
    font: inherit;
    font-size: 0.8rem;
    background: none;
    border: 1px solid var(--border);
    border-radius: 5px;
    padding: 0.2rem 0.55rem;
    color: var(--muted);
    cursor: pointer;
  }
  .reset:hover,
  .reset:focus-visible {
    color: var(--blue);
    border-color: var(--blue);
  }

  .results {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
  }
  .result {
    border: 1px solid var(--border);
    border-left: 3px solid var(--green);
    border-radius: 6px;
    padding: 0.6rem 0.75rem;
    background: var(--bg);
  }
  .result.swap {
    border-left-color: var(--gold);
  }
  .result.blocked {
    border-left-color: var(--border);
    background: none;
  }

  .result-head {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .badge {
    flex: none;
    font-size: 0.68rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 0.12rem 0.4rem;
    border-radius: 4px;
    background: var(--green-lt);
    color: var(--green);
  }
  .badge.swap {
    background: var(--gold-lt);
    color: var(--gold);
  }
  .badge.blocked {
    background: var(--panel-bg);
    color: var(--muted);
  }
  .q {
    font-weight: 600;
    font-size: 0.92rem;
    color: var(--text);
  }
  .result.blocked .q {
    color: var(--muted);
    font-weight: 500;
  }
  .q-context {
    display: inline-block;
    margin-left: 0.4rem;
    font-weight: 400;
    font-size: 0.78rem;
    color: var(--muted);
  }

  .method {
    margin: 0.4rem 0 0;
    font-size: 0.88rem;
    line-height: 1.5;
    color: var(--text);
  }
  .reason {
    margin: 0.4rem 0 0;
    font-size: 0.84rem;
    line-height: 1.5;
    color: var(--muted);
  }
  .meta {
    display: flex;
    justify-content: space-between;
    gap: 0.75rem;
    flex-wrap: wrap;
    margin: 0.45rem 0 0;
    font-size: 0.8rem;
    color: var(--muted);
  }
  .go a {
    color: var(--blue);
    font-weight: 600;
    text-decoration: none;
  }
  .go a:hover {
    text-decoration: underline;
  }
  .sep {
    margin: 0 0.3rem;
    color: var(--border);
  }
</style>
