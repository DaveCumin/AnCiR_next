<script>
  import sections from '../sections_data.json';

  export let id = '';

  let html = '';

  $effect.pre(() => {
    if (id && sections[id]) {
      html = sections[id];
    }
  });
</script>

<div {id} class="section-wrapper">
  {@html html}
</div>

<style>
  :global(section) {
    scroll-margin-top: var(--header-h);
  }
</style>
