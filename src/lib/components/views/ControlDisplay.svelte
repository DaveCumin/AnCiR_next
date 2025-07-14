<!-- Handle click plot (plot id core state) -->
<script module>
	export function closeControlPanel() {
		appState.selectedPlotId = null;
		appState.showControlPanel = false;
		appState.positionControlPanel = window.innerWidth;
	}
</script>

<script>
	// @ts-nocheck
	import Icon from '$lib/icons/Icon.svelte';

	import { appConsts, appState, core } from '$lib/core/core.svelte';
</script>

<div class="heading">
	<p>Control Panel</p>

	<div class="add">
		<button onclick={closeControlPanel}>
			<Icon name="close" width={16} height={16} className="close" />
		</button>
	</div>
</div>

<div class="control-display">
	<p>{appState.selectedPlotId}</p>

	{#key appState.selectedPlotId}
		{#if appState.selectedPlotId >= 0}
			{@const plot = core.plots.find((p) => p.id === appState.selectedPlotId)}
			{#if plot}
				{@const Plot = appConsts.plotMap.get(plot.type).plot ?? null}
				{#if Plot}
					<p>{core.plots.find((p) => p.id === appState.selectedPlotId)?.name}</p>
					<p>{JSON.stringify(core.plots.find((p) => p.id === appState.selectedPlotId)?.plot)}</p>
					<Plot theData={plot.plot} which="controls" />
				{/if}
			{/if}
		{/if}
	{/key}
</div>

<style>
	.heading {
		position: sticky;
		top: 0;
		width: 100%;
		height: 4vh;
		display: flex;
		flex-direction: row;
		justify-content: center;
		align-items: center;

		/* border-bottom: 1px solid #d9d9d9; */
		background-color: white;
	}

	.heading p {
		margin-left: 0.6rem;
		/* font-weight: bold; */
	}

	button {
		background-color: transparent;
		border: none;
		margin-right: 0.6rem;
		padding: 0;
		text-align: inherit;
		font: inherit;
		border-radius: 0;
		appearance: none;
		display: flex;
		justify-content: center;
		align-items: center;
	}

	.control-display {
		margin-left: 1rem;
		margin-right: 1rem;
	}
</style>
