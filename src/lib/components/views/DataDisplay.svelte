<script>
	import { core, appState } from '$lib/core/theCore.svelte.js';
	import Icon from '$lib/icon/Icon.svelte';
	import AddTable from '../dropdowns/AddTable.svelte';

	import { simulateData } from '$lib/models/data/dataTree.svelte';
	import {
		importDataUtils,
		setFilesToImport,
		getTempData
	} from '$lib/models/data/importData.svelte';

	let previewHTML = '';
	let importReady = false;

	async function onFileChange(e) {
		setFilesToImport(e.target.files);
		await importDataUtils.parseFile(6);
		previewHTML = importDataUtils.makeTempTable(getTempData());
		importReady = true;
	}

	function chooseFile() {
		importDataUtils.openFileChoose();
	}

	async function confirmImport() {
		await importDataUtils.loadData();
		alert('Imported!'); // better UI
	}
	

	// test reactivity
	function changeDataFieldContent() {
		core.data[0].columns[1].dataArr[0] = core.data[0].columns[1].dataArr[0] + Math.round(Math.random() * 10, 2);
	}

	// AddTable dropdown
	let addBtnRef;
	let dropdownPos = { top: 0, left: 0 };

	function openDropdown() {
		if (appState.currentTab === 'data') {
			
		}
		if (appState.addIcon === 'AddTable') {
			appState.addIcon = '';
		} else {
			const rect = addBtnRef.getBoundingClientRect();
			dropdownPos = {
				top: rect.bottom + window.scrollY,
				left: rect.left + window.scrollX
			};
			appState.addIcon = 'AddTable';
		}
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
	{#each core.data as entry (entry.id)}
		<details>
			<summary>{entry.name}</summary>
			<button onclick={() => entry.name = 'happy_data' + Math.round(Math.random() * 10, 2)}> change item name </button>
			<p><strong>importedFrom:</strong>{entry.importedFrom}</p>
			<p><strong>Length:</strong>{entry.dataLength}</p>

			{#each entry.columns as field (field.id)}
				<details>
					<summary>{field.type}</summary>
					<ul>
						{#each field.dataArr.slice(0, 5) as test}
							<li>{test}</li>
						{/each}
					</ul>
				</details>
			{/each}
		</details>
	{/each}
</div>

<!-- <div class="test">
	<button onclick={changeDataFieldContent}> change data point </button>
</div> -->

<div class="import-container">

	<button class="btn" onclick={chooseFile}>Choose File</button>
	<input id="fileInput" type="file" accept=".csv,.awd" onchange={onFileChange} />

	{#if previewHTML}
		<div class="preview-table">
			<h3>Preview</h3>
			{@html previewHTML}
		</div>
	{/if}

	<!-- Add this if you define `let importReady = true;` inside <script> -->
	{#if importReady}
		<button class="btn" onclick={confirmImport}>Import Data</button>
	{/if}
</div>


{#if appState.addIcon === 'AddTable'}
	<AddTable top={dropdownPos.top} left={dropdownPos.left} />
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

	/* .add :global(svg) {
		vertical-align: middle;
		color: var(--color-icon-unselected, blue);
	} */
</style>
