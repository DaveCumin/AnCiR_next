<script>
  let { id = '', num = '', title = '', children } = $props();
</script>

<section {id}>
  <h2 class="chapter-title">
    <span class="chapter-num">{num}</span>
    {title}
  </h2>
  {@render children()}
</section>
