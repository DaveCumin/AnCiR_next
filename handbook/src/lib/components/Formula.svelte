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
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- KaTeX output for a tex literal written in the handbook source; katex escapes its input -->
	{@html html()}
</div>

<style>
	.formula {
		background: #f3f4f6;
		border: 1px solid var(--border);
		border-radius: 4px;
		padding: 14px 18px;
		margin: 1rem 0;
		overflow-x: auto;
		line-height: 1.6;
		text-align: center;
	}
</style>
