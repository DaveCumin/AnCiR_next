<script>
	// TODO: multiple select on control plots,
	// bulk change (e.g. width)

	// @ts-nocheck
	import { core } from '$lib/core/core.svelte.js';
	import Icon from '$lib/icons/Icon.svelte';
	import AddTable from '../addIconActions/AddTable.svelte';

	// test reactivity
	function changeDataFieldContent() {
		core.data[0].columns[1].dataArr[0] = core.data[0].columns[1].dataArr[0] + Math.round(Math.random() * 10, 2);
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

	function openDropdown() {
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

<div class="data-list">
	{#each core.tables as entry (entry.id)}
		<details class="table-item">
			<summary>{entry.name}</summary>
			<!-- <button onclick={() => entry.name = 'happy_data' + Math.round(Math.random() * 10, 2)}> change item name </button> -->
			{#each entry.columns as col (col.id)}
				<details class="column-item">
					<summary>{col.type}</summary>
					<p>{col.data.slice(0, 10)}</p>
					<!-- processes -->
				</details>
			{/each}
		</details>
	{/each}
</div>

<!-- <div class="test">
	<button onclick={changeDataFieldContent}> change data point </button>
</div> -->

{#if showAddTable}
	<AddTable bind:showDropdown={showAddTable} dropdownTop={dropdownTop} dropdownLeft={dropdownLeft} />
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

	.data-list {
		width: 100%;
		margin-top: 0.2rem;

		font-size: 14px;
	}

	/* hover effect, need update */
	.table-item:hover > summary {
	background-color: var(--color-lightness-95);
	}

	.column-item:hover > summary {
		background-color: var(--color-lightness-95);
	}

	/* .table-container[open] {
		background-color: var(--color-lightness-98);
	} */

	.table-item summary {
		font-weight: bold;
		padding-bottom: 0.2rem;
	}

	.table-item {
		margin-left: 0.5rem;
		padding-top: 0.2rem;
		padding-bottom: 0.2rem;
	}
	
	.column-item {
		margin-left: 1rem;
		padding-top: 0.2rem;
		padding-bottom: 0.2rem;
	}
	
	.column-item summary{
		font-weight: normal;
		padding-bottom: 0;
	}

	
	 
</style>
