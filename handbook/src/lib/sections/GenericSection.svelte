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
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- static handbook chapter markup bundled from src/lib/sections_data.json at build time; no user input reaches it -->
	{@html html}
</div>

<style>
	:global(section) {
		scroll-margin-top: var(--header-h);
	}
</style>
