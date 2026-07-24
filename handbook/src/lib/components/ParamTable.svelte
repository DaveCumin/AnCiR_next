<script>
  let { headers = [], rows = [] } = $props();
</script>

<table class="param-table">
  <thead>
    <tr>{#each headers as h}<th>{@html h}</th>{/each}</tr>
  </thead>
  <tbody>
    {#each rows as row}
      <tr>{#each row as cell}<td>{@html cell}</td>{/each}</tr>
    {/each}
  </tbody>
</table>
