<script>
  let { title = "In AnCiR", tip = "", children } = $props();
</script>

<div class="box box-ancir">
  <div class="box-title">🔬 {title}</div>
  {@render children()}
  {#if tip}
    <div class="tip">💡 <strong>Tip:</strong> {@html tip}</div>
  {/if}
</div>

<style>
  .box-ancir {
    background: var(--blue-lt);
    border-color: var(--blue);
  }
  .box-ancir .box-title {
    color: #1a4b8a;
  }
  :global(.box-ancir ol) {
    margin: 0;
    padding-left: 1.3rem;
  }
  :global(.box-ancir li) {
    margin-bottom: 6px;
    font-size: 0.9rem;
    line-height: 1.55;
  }
  .tip {
    margin-top: 12px;
    padding: 8px 12px;
    background: rgba(74, 144, 217, 0.1);
    border-radius: 4px;
    font-size: 0.82rem;
    color: var(--color-info-text, #1a73e8);
  }
</style>
