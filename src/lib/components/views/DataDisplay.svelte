<script>
	// import CollapsibleSection from '$lib/ui/CollapsibleSection.svelte';
	import { core } from '$lib/core/theCore.svelte.js';
	import Table from '$lib/core/Table.svelte';
	import Icon from '$lib/icon/Icon.svelte';
	import Column from '$lib/core/Column.svelte';

	// test reactivity
	function changeName() {
		/*
        change name of simulate_0 to happy_data
        */
		core.tables[0].name = 'happy_data' + Math.round(Math.random() * 10, 2);
	}

	function changeDataFieldContent() {
		console.log(JSON.stringify(core.data[0]));
		core.data[0].rawData[0] = Math.round(Math.random() * 100, 2);
	}
</script>

<div class="container">
	<div class="heading">
		<p>Data Sources</p>

		<div class="add">
			<button
				onclick={() =>
					core.tables.push(new Table({ name: 'table' + Math.round(Math.random() * 1000, 2) }))}
			>
				<Icon name="add" width={16} height={16} />
			</button>
		</div>
	</div>

	<div class="data-list" style="overflow:scroll;">
		{#each core.tables as table}
			<Table {table} />
		{/each}
	</div>

	-------------------
	<div class="test">
		<button onclick={changeName}> change item name </button>

		<button onclick={changeDataFieldContent}> change data point </button>
	</div>
</div>

<style>
	.container {
		width: 16vw;
		height: 100vh;
		display: flex;
		flex-direction: column;
		justify-content: start;
		align-items: start;

		position: fixed;
		top: 0;
		left: 4vw;

		border-right: 1px solid #d9d9d9;
	}

	.heading {
		width: 16vw;
		height: 4vh;
		display: flex;
		flex-direction: row;
		justify-content: space-between;
		align-items: center;

		border-bottom: 1px solid #d9d9d9;
	}

	.heading p {
		margin-left: 0.6rem;
		font-weight: bold;
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

	.add :global(svg) {
		vertical-align: middle;
		color: var(--color-icon-unselected, blue);
	}
</style>
