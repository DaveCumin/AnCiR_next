<script>
	import Icon from '$lib/icons/Icon.svelte';
	import { appConsts } from '$lib/core/core.svelte.js';
	import { removePlots } from '$lib/core/Plot.svelte';
	import { NodeResizer } from '@xyflow/svelte';

	let { data, selected } = $props();
	console.log('data: ', data);
	let plot = data.data.plot;
	console.log('plot: ', plot);
</script>

{#if plot}
	<NodeResizer minWidth={100} minHeight={30} isVisible={selected} />

	<div class="plot-node-wrapper" class:selected>
		<div class="plot-header">
			<p
				contenteditable="false"
				ondblclick={(e) => {
					e.target.setAttribute('contenteditable', 'true');
					e.target.focus();
				}}
				onfocusout={(e) => e.target.setAttribute('contenteditable', 'false')}
				bind:innerHTML={data.data.name}
			></p>

			<div class="clps-title-button">
				<button
					class="icon"
					onclick={(e) => {
						e.stopPropagation();
						plot.toggleFullscreen();
					}}
				>
					{#if plot.fullscreen}
						<Icon name="minimise" width={20} height={20} />
					{:else}
						<Icon name="maximise" width={20} height={20} />
					{/if}
				</button>
				<button
					class="icon"
					onclick={(e) => {
						e.stopPropagation();
						removePlots(plot.id);
					}}
				>
					<Icon name="close" width={16} height={16} />
				</button>
			</div>
		</div>

		<div class="plot-content">
			{#if data.data.plot}
				{@const Plot = appConsts.plotMap.get(data.data.type).plot ?? null}
				<Plot theData={data.data} which="plot" />
			{/if}
		</div>
	</div>
{/if}

<style>
	.plot-node-wrapper {
		background: white;
		border: 1px solid var(--color-lightness-85);
		border-radius: 4px;
		overflow: hidden;
		width: 100% !important;
		height: 100% !important;
		box-shadow: 0 2px 5px rgba(0, 0, 0, 0.15);
	}

	.plot-header {
		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: space-between;
		padding: 0.5rem 0.4rem 0.5rem 1rem;
		background-color: var(--color-lightness-98);
		border-bottom: 1px solid var(--color-lightness-85);
		font-weight: bold;
		cursor: grab;
	}

	.plot-header:active {
		cursor: grabbing;
	}

	.plot-header p {
		margin: 0;
	}

	.plot-content {
		padding: 0.5rem;
		cursor: default;
	}

	.clps-title-button {
		display: flex;
		gap: 0.25rem;
	}

	.plot-node-wrapper.selected {
		border: 2px solid #0275ff !important;
		box-shadow: 0 0 12px rgba(2, 117, 255, 0.5);
	}
</style>
