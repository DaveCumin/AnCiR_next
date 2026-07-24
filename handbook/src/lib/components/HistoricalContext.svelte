<script>
  let { entries = [] } = $props();
</script>

<div class="box box-history">
  <div class="box-title">📜 Historical Context</div>
  {#each entries as entry (entry.year)}
    <div class="timeline-entry">
      <span class="timeline-year">{entry.year}</span> — {@html entry.text}
    </div>
  {/each}
</div>

<style>
  .box-history { background: #FFFBEB; border-color: #D97706; }
  .box-history .box-title { color: #92400E; }
  .timeline-entry { margin-bottom: 7px; font-size: .9rem; line-height: 1.5; }
  .timeline-year { font-weight: 600; color: #92400E; }
</style>
