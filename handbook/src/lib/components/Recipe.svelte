<script>
  import DemoLink from "./DemoLink.svelte";
  let {
    title,
    chapters = "",
    when = "",
    data = "",
    steps = [],
    readoff = "",
    pitfall = "",
    session = "",
    sessionLabel = "Open this example in AnCiR",
  } = $props();
</script>

<div class="recipe">
  <h4 class="recipe-title">{title}</h4>
  {#if chapters}
    <div class="recipe-chapters">Method explained in {@html chapters}</div>
  {/if}
  {#if when}
    <p class="recipe-field">
      <span class="recipe-label">When to use it</span>
      {@html when}
    </p>
  {/if}
  {#if data}
    <p class="recipe-field">
      <span class="recipe-label">Data you need</span>
      {@html data}
    </p>
  {/if}
  {#if steps.length}
    <div class="recipe-field">
      <span class="recipe-label">The node chain</span>
      <ol>
        {#each steps as s}
          <li>{@html s}</li>
        {/each}
      </ol>
    </div>
  {/if}
  {#if readoff}
    <p class="recipe-field">
      <span class="recipe-label">What to read off</span>
      {@html readoff}
    </p>
  {/if}
  {#if pitfall}
    <p class="recipe-field recipe-pitfall">
      <span class="recipe-label">Pitfall</span>
      {@html pitfall}
    </p>
  {/if}
  {#if session}
    <DemoLink {session} label={sessionLabel} />
  {/if}
</div>

<style>
  .recipe {
    margin: 1.5rem 0;
    padding: 1.1rem 1.3rem 1.3rem;
    border: 1px solid var(--border, #d9e2ec);
    border-left: 4px solid var(--blue, #3e7295);
    border-radius: 0 8px 8px 0;
    background: var(--card-bg, rgba(62, 114, 149, 0.04));
  }
  .recipe-title {
    margin: 0 0 0.35rem;
    font-size: 1.05rem;
    font-weight: 700;
    color: var(--text, #1a202c);
  }
  .recipe-chapters {
    font-size: 0.78rem;
    color: var(--muted, #6b7280);
    margin-bottom: 0.9rem;
  }
  .recipe-field {
    margin: 0.55rem 0;
    font-size: 0.92rem;
    line-height: 1.6;
  }
  .recipe-label {
    display: block;
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--blue, #3e7295);
    margin-bottom: 0.15rem;
  }
  .recipe :global(ol) {
    margin: 0.2rem 0 0;
    padding-left: 1.3rem;
  }
  .recipe :global(li) {
    margin-bottom: 5px;
    font-size: 0.92rem;
    line-height: 1.55;
  }
  .recipe-pitfall :global(strong),
  .recipe-pitfall {
    color: var(--text, #1a202c);
  }
</style>
