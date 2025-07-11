<script>
	// TODO: multiple select on control plots,
	// bulk change (e.g. width)

	// @ts-nocheck
	import { core, appConsts } from '$lib/core/core.svelte.js';
	import Icon from '$lib/icons/Icon.svelte';
	import AddTable from '../iconActions/AddTable.svelte';
	import Column from '$lib/core/Column.svelte';

	let { canChange = false } = $props();

	// test reactivity
	function changeDataFieldContent() {
		console.log($state.snapshot(core.data));
		core.data[1].data[0] = core.data[0].data[0] + Math.round(Math.random() * 10, 2);
	}

	// AddTable dropdown
	let addBtnRef;
	let showAddTable = $state(false);
	let dropdownTop = $state(0);
	let dropdownLeft = $state(0);

	function recalculateDropdownPosition() {
		if (!addBtnRef) return;
		const rect = addBtnRef.getBoundingClientRect();

		dropdownTop = rect.top + window.scrollY;
		dropdownLeft = rect.right + window.scrollX + 12;
	}

	function openDropdown(e) {
		e.stopPropagation();
		recalculateDropdownPosition();
		requestAnimationFrame(() => {
			showAddTable = true;
		});
		window.addEventListener('resize', recalculateDropdownPosition);
	}
</script>

<div class="heading">
	<p>Data Sources</p>

	<div class="add">
		<button bind:this={addBtnRef} onclick={openDropdown}>
			<Icon name="add" width={16} height={16} />
		</button>
	</div>
</div>

<!-- TODO: write custom component to achieve -->
<div class="display-list">
	{#each core.tables as table (table.id)}
		<div class="table-container">
			<details class="table-item">
				<summary class="table-name">{table.name}</summary>
				{#each table.columns as col}
					<Column col={core.data.find((c) => c.id === col.id)} />
				{/each}
			</details>
		</div>
	{/each}
</div>

<!-- <div class="data-list">
	{#each core.tables as entry (entry.id)}
		<div class="card">
			<p>{entry.name}</p>
		</div>
	{/each}
</div> -->

<!-- <div class="test">
	<button onclick={changeDataFieldContent}> change data point </button>
</div> -->

{#if showAddTable}
	<AddTable bind:showDropdown={showAddTable} {dropdownTop} {dropdownLeft} />
{/if}

<style>
	.heading {
		position: sticky;
		top: 0;

		width: 100%;
		height: 4vh;
		display: flex;
		flex-direction: row;
		justify-content: space-between;
		align-items: center;

		border-bottom: 1px solid #d9d9d9;
		background-color: white;
	}

	.heading p {
		margin-left: 1rem;
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

	.display-list {
		width: 100%;
		margin-top: 0.5rem;
	}

	/* TODO: hover effect, need update */
	summary::marker {
		margin-right: 1.2rem;
	}

	summary:open {
		margin-top: 0.3rem;
		margin-bottom: 0.5rem;
	}

	details:open {
		margin-bottom: 0.5rem;
	}

	details:open > summary.table-name {
		background-color: pink;
	}

	.table-container {
		margin-left: 0.5rem;
	}

	.table-container:hover {
		background-color: var(--color-lightness-98);
		border-radius: 5px 0 0 5px;
	}

	.table-item {
		margin-left: 0.5rem;
		padding-top: 0.2rem;
		padding-bottom: 0.2rem;
	}

	.column-item {
		margin-left: 1rem;
	}
</style>
