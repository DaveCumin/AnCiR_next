<!-- Handle click plot (plot id core state) -->
<script module>
	export function closeControlPanel() {
		appState.selectedPlotIds = [];
		appState.showControlPanel = false;
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
	<!-- This is only for the first selected plot - need an #if to take care of multiple selections -->
	<p>{appState.selectedPlotIds}</p>

	{#key appState.selectedPlotIds}
		{#if appState.selectedPlotIds.length >= 0}
			{@const plot = core.plots.find((p) => p.id === appState.selectedPlotIds[0])}
			{#if plot}
				{@const Plot = appConsts.plotMap.get(plot.type).plot ?? null}
				{#if Plot}
					<p>{core.plots.find((p) => p.id === appState.selectedPlotIds[0])?.name}</p>
					<p>
						{JSON.stringify(core.plots.find((p) => p.id === appState.selectedPlotIds[0])?.plot)}
					</p>
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
