<script>
  let { title = 'Watch Out', children } = $props();
</script>

<div class="box box-warn">
  <div class="box-title">⚠️ {title}</div>
  {@render children()}
</div>

<style>
  .box-warn { background: #FFF7ED; border-color: #EA580C; }
  .box-warn .box-title { color: #9A3412; }
</style>
