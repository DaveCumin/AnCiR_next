<script>
	import { onMount } from 'svelte';

	let { name = '', width = 24, height = 24, className = 'icon' } = $props();
	let svgContent = $state();

	const icons = import.meta.glob('$lib/icons/*.svg', { query: '?raw', import: 'default' });
	//rename the keys to be the name of the icon
	for (const key in icons) {
		const newKey = key.split('/').pop().split('.')[0]; //get the name of the icon
		icons[newKey] = icons[key];
		delete icons[key];
	}

	onMount(async () => {
		if (icons[name]) {
			let raw = await icons[name]();

			// Replace hardcoded fills with fill="currentColor"
			raw = raw.replace(/fill=".*?"/g, 'fill="currentColor"');

			svgContent = raw;
		} else {
			console.error(`Icon "${name}" not found`);
		}
	});
</script>

<svg xmlns="http://www.w3.org/2000/svg" {width} {height} viewBox="0 0 24 24" class={className}>
	{@html svgContent}
</svg>

<style>
	.spinner {
		fill: var(--color-lightness-35);
		transition: fill 0.2s ease;
		animation: spin 1s linear infinite;
	}
	@keyframes spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}

	.static-icon {
		fill: var(--color-lightness-35);
		transition: fill 0.2s ease;
		cursor: pointer;
	}

	.icon {
		fill: var(--color-icon-unselected);
		transition: fill 0.2s ease;
		cursor: pointer;
	}

	.icon:hover {
		fill: var(--color-hover);
	}

	.icon.active {
		fill: var(--color-icon-selected);
	}

	.close {
		fill: var(--color-icon-unselected);
		transition: fill 0.2s ease;
		cursor: pointer;
	}
	.close:hover {
		fill: var(--color-icon-close-hover);
		transition: fill 0.2s ease;
		cursor: pointer;
	}

	.menu-icon {
		fill: var(--color-lightness-35);
		transition: fill 0.2s ease;
		cursor: pointer;
	}

	.menu-icon:hover {
		background-color: var(--color-lightness-90);
		border-radius: 100px;
	}

	.control-component-title-icon {
		fill: var(--color-lightness-35);
		transition: fill 0.2s ease;
		cursor: pointer;
	}

	.control-component-title-icon:hover {
		fill: var(--color-hover);
	}

	.control-component-input-icon {
		fill: var(--color-lightness-35);
		transition: fill 0.2s ease;
		cursor: pointer;
	}

	.control-component-input-icon:hover {
		fill: var(--color-hover);
	}

	.first-detail-title-icon {
		fill: var(--color-lightness-35);
		transition: fill 0.2s ease;
		cursor: pointer;
	}

	.first-detail-title-icon:hover {
		background-color: var(--color-lightness-90);
		border-radius: 100px;
	}

	.second-detail-title-icon {
		margin: 0;

		fill: var(--color-lightness-55);
		transition: fill 0.2s ease;
		cursor: pointer;
	}

	.second-detail-title-icon:hover {
		background-color: var(--color-lightness-90);
		border-radius: 100px;
	}

	.visible {
		fill: var(--color-lightness-35);
		transition: fill 0.2s ease;
		cursor: pointer;
	}

	.visible:hover {
		fill: var(--color-hover);
	}
</style>
