<script>
	import { onMount } from 'svelte';

	let { name = '', width = 24, height = 24, style = 'fill: #D9D9D9;' } = $props();
	let svgContent = $state();

	const icons = import.meta.glob('$lib/icon/*.svg', { query: '?raw', import: 'default' });
	//rename the keys to be the name of the icon
	for (const key in icons) {
		const newKey = key.split('/').pop().split('.')[0]; //get the name of the icon
		icons[newKey] = icons[key];
		delete icons[key];
	}

	onMount(async () => {
		if (icons[name]) {
			svgContent = await icons[name]();
		} else {
			console.error(`Icon "${name}" not found`);
		}
	});
</script>

<svg {style} xmlns="http://www.w3.org/2000/svg" {width} {height} viewBox="0 0 24 24">
	{@html svgContent}
</svg>
