<script>
  import katex from 'katex';

  let { tex = '' } = $props();

  const html = $derived(() => {
    try {
      return katex.renderToString(tex, { displayMode: true, throwOnError: false });
    } catch {
      return `<span style="color:red">Formula error: ${tex}</span>`;
    }
  });
</script>

<div class="formula">
  {@html html()}
</div>

<style>
  .formula {
    background: #F3F4F6;
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 14px 18px;
    margin: 1rem 0;
    overflow-x: auto;
    line-height: 1.6;
    text-align: center;
  }
</style>
