<script lang="ts" module>
	/**
	 * Inline SVG icon component.
	 *
	 * - The icon set is shared with non-component contexts (tour bodies, etc.)
	 *   through `iconRegistry.js` — one glob, one copy in the bundle.
	 * - The source SVG is rendered as-is so its own `viewBox` is preserved.
	 *   Wrapping it in a second `<svg viewBox="0 0 24 24">` (the previous
	 *   approach) cropped/scaled icons whose source viewBox differed (e.g.
	 *   FontAwesome's "0 0 512 512").
	 * - `fill="none"` is preserved so outline-only icons keep their outline.
	 */
	import { getIconRaw, hasIcon } from './iconRegistry.js';
</script>

<script>
	let { name = '', width = 24, height = 24, className = 'icon' } = $props();

	const svg = $derived(getIconRaw(name));

	$effect(() => {
		if (name && !hasIcon(name)) {
			console.error(`Icon "${name}" not found`);
		}
	});
</script>

<span
	class={className}
	style:--icon-width={typeof width === 'number' ? `${width}px` : width}
	style:--icon-height={typeof height === 'number' ? `${height}px` : height}
>
	<!-- SVG files are trusted local assets shipped in the bundle, so {@html} is safe. -->
	{@html svg}
</span>

<style>
	span {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: var(--icon-width, 24px);
		height: var(--icon-height, 24px);
		flex-shrink: 0;
		line-height: 0;
	}
	span :global(svg) {
		width: 100%;
		height: 100%;
		display: block;
	}

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

	.icon.disabled {
		fill: var(--color-lightness-75);
		cursor: not-allowed;
	}

	.icon.disabled:hover {
		fill: var(--color-lightness-75);
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
