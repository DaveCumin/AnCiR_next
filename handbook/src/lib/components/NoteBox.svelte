<script>
  let { title = 'Key Point', children } = $props();
</script>

<div class="box box-note">
  <div class="box-title">📌 {title}</div>
  {@render children()}
</div>

<style>
  .box-note { background: #F0FDF4; border-color: #16A34A; }
  .box-note .box-title { color: #15803D; }
</style>
