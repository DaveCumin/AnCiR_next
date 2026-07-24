<script>
  // End-of-chapter catalogue of ready-made AnCiR sessions relevant to this
  // chapter, derived from the bundled session manifest (no hand authoring).
  import DemoLink from "./DemoLink.svelte";
  import { sessionsForChapter } from "$lib/exampleChapters.js";

  let { chapter, limit = 4 } = $props();
  const result = $derived(sessionsForChapter(chapter, limit));
</script>

{#if result.total > 0}
  <div class="chapter-examples">
    <div class="ce-head">Worked examples for this chapter</div>
    <ul class="ce-list">
      {#each result.shown as s}
        <li>
          <div class="ce-name">{s.name?.replace(/^Workflow — /, "") ?? s.id}</div>
          {#if s.summary}<div class="ce-summary">{s.summary}</div>{/if}
          <DemoLink session={s.url} label="Open in AnCiR" />
        </li>
      {/each}
    </ul>
    {#if result.total > result.shown.length}
      <a class="ce-more" href="#example-gallery"
        >See all {result.total} examples for this chapter in the Example Gallery →</a
      >
    {/if}
  </div>
{/if}

<style>
  .chapter-examples {
    margin: 1.75rem 0 0.5rem;
    padding: 1rem 1.2rem 1.1rem;
    border: 1px solid var(--border, #d9e2ec);
    border-radius: 8px;
    background: var(--card-bg, rgba(62, 114, 149, 0.03));
  }
  .ce-head {
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--blue, #3e7295);
    margin-bottom: 0.7rem;
  }
  .ce-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 0.9rem;
  }
  .ce-list li {
    margin: 0;
    padding: 0.7rem 0.8rem;
    border: 1px solid var(--border, #e2e8f0);
    border-radius: 6px;
    background: var(--bg, #fff);
  }
  .ce-name {
    font-weight: 600;
    font-size: 0.9rem;
    margin-bottom: 0.2rem;
    color: var(--text, #1a202c);
  }
  .ce-summary {
    font-size: 0.82rem;
    line-height: 1.45;
    color: var(--muted, #556);
    margin-bottom: 0.3rem;
  }
  .ce-more {
    display: inline-block;
    margin-top: 0.85rem;
    font-size: 0.83rem;
    color: var(--blue, #3e7295);
    font-weight: 600;
    text-decoration: none;
  }
  .ce-more:hover {
    text-decoration: underline;
  }
</style>
