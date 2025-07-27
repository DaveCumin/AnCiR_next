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
	import { convertToImage } from '$lib/components/plotBits/helpers/save.js';
</script>



<div class="control-display">

	<!-- This is only for the first selected plot - need an #if to take care of multiple selections -->
	<!-- <p>{appState.selectedPlotIds}</p> -->

	{#key appState.selectedPlotIds}
		{#if appState.selectedPlotIds.length > 0}
			{@const plot = core.plots.find((p) => p.id === appState.selectedPlotIds[0])}
			{#if plot}
				{@const Plot = appConsts.plotMap.get(plot.type).plot ?? null}
				{#if Plot}
					<!-- <p>{core.plots.find((p) => p.id === appState.selectedPlotIds[0])?.name}</p>
					<p>
						{JSON.stringify(core.plots.find((p) => p.id === appState.selectedPlotIds[0])?.plot)}
					</p> -->

					<div class="control-banner">
						<p>Control Panel</p>

						<div class="control-banner-icons">
							<button class="icon" onclick={() => convertToImage('plot' + plot.plot.parentBox.id, 'svg')}>
								<Icon name="disk" width={16} height={16} className="control-component-title-icon" />
							</button>
							
							<!-- <button class="icon">
								<Icon name="reset" width={16} height={16} className="control-component-title-icon" />
							</button> -->
						</div>
					</div>

					<div class="control-tag">
						<button class={appState.currentControlTab === 'properties' ? 'active' : ''} onclick={() => appState.currentControlTab = 'properties'}>Properties</button>
						<button class={appState.currentControlTab === 'data' ? 'active' : ''} onclick={() => appState.currentControlTab = 'data'}>Data</button>
					</div>

					<div class="div-line"></div>
					<Plot theData={plot.plot} which="controls" />
				{/if}
			{/if}
		{:else}
		<div class="control-banner">
			<p>Control Panel</p>

			<div class="control-banner-icons">
				<button class="icon">
					<Icon name="reset" width={16} height={16} className="control-component-title-icon" />
				</button>
			</div>
		</div>

		<div class="control-tag">
			<button class={appState.currentControlTab === 'properties' ? 'active' : ''} onclick={() => appState.currentControlTab = 'properties'}>Properties</button>
			<button class={appState.currentControlTab === 'files' ? 'active' : ''} onclick={() => appState.currentControlTab = 'files'}>Files</button>
		</div>

		<div class="div-line"></div>

		<!-- TODO: implement grid size change -->
		{/if}
	{/key}

	<div class="div-block"></div>
</div>

<style>
	.heading {
		position: sticky;
		top: 0;
		width: 100%;
		/* height: 4vh; */
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

	.control-display {
		top: 0;
		width: calc(100% - 2rem);
		margin-left: 1rem;
	}
</style>
