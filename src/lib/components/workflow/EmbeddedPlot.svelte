<script>
	// @ts-nocheck
	import { appConsts } from '$lib/core/core.svelte.js';

	let { plot, size, onResizeMouseDown } = $props();

	const PlotComp = $derived(appConsts.plotMap.get(plot?.type)?.plot);
	const previewScale = $derived(plot?.width ? size.w / plot.width : 1);
</script>

{#if PlotComp && plot}
	<div class="plot-preview-panel" style="width:{size.w}px; height:{size.h}px;">
		<div
			class="plot-preview-inner"
			style="transform:scale({previewScale}); transform-origin:top left; width:{plot.width}px; height:{plot.height}px;"
		>
			<PlotComp theData={plot} which="plot" />
		</div>
		{#if onResizeMouseDown}
			<div
				class="plot-resize-handle"
				onmousedown={(e) => onResizeMouseDown(e)}
				title="Drag to resize"
				role="button"
				tabindex="-1"
			>
				⤡
			</div>
		{/if}
	</div>
{/if}

<style>
	.plot-preview-panel {
		overflow: hidden;
		border: 1.5px solid rgba(0, 0, 0, 0.15);
		border-top: none;
		border-bottom-left-radius: 6px;
		border-bottom-right-radius: 6px;
		background: var(--surface-card);
		box-shadow: var(--shadow-1);
		box-sizing: border-box;
		position: relative;
	}

	.plot-preview-inner {
		pointer-events: none;
	}

	.plot-resize-handle {
		position: absolute;
		bottom: 2px;
		right: 2px;
		width: 16px;
		height: 16px;
		font-size: var(--font-xs);
		line-height: 16px;
		text-align: center;
		cursor: nwse-resize;
		color: #888;
		background: rgba(255, 255, 255, 0.8);
		border-radius: 2px;
		user-select: none;
	}

	.plot-resize-handle:hover {
		color: #333;
		background: rgba(255, 255, 255, 1);
	}
</style>
