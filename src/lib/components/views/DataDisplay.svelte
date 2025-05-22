<script>
	// import CollapsibleSection from '$lib/ui/CollapsibleSection.svelte';
	import { core } from '$lib/core/theCore.svelte.js';
	import Icon from '$lib/icon/Icon.svelte';

	import { data } from '$lib/store.svelte';
	// import { DataItem } from '$lib/models/data/dataItem.svelte';
	import { simulateData, importData } from '$lib/models/data/dataTree.svelte';
	import {
		importDataUtils,
		setFilesToImport,
		getTempData
	} from '$lib/models/data/importData.svelte';

	let previewHTML = '';
	let importReady = false;

	async function onFileChange(event) {
		setFilesToImport(event.target.files);
		await importDataUtils.parseFile(6);
		previewHTML = importDataUtils.makeTempTable(getTempData());
		importReady = true;
	}

	function chooseFile() {
		importDataUtils.openFileChoose();
	}

	async function confirmImport() {
		await importDataUtils.loadData();
		alert('Imported!');
	}
	

	// test reactivity
	function changeName() {
		/*
        change name of simulate_0 to happy_data
        */
		core.tables[0].name = 'happy_data' + Math.round(Math.random() * 10, 2);
	}

	function changeDataFieldContent() {
		core.data[0].rawData[0] = core.data[0].rawData[0] + Math.round(Math.random() * 10, 2);
	}

</script>

<div class="container">
	<div class="heading">
		<p>Data Sources</p>

		<div class="add">
			<button onclick={simulateData}>
				<Icon name="add" width={16} height={16} />
			</button>
		</div>
	</div>

	<div class="data-list">
		{#each core.tables as table}
			<details open>
				<summary>{table.tableid} - {table.name}</summary>
				{#each table.columnRefs as col}
					{#each core.data as dat}
						{#if dat.columnID == col}
							<details open>
								<summary>{dat.name} {dat.columnID}</summary>
								<ul>
									{dat.type}
									<li>{dat.getData().slice(0, 5)}</li>
								</ul>
							</details>
						{/if}
					{/each}
				{/each}
			</details>
		{/each}
	</div>

	-------------------
	<div class="test">
		<button onclick={changeDataFieldContent}> change data point </button>
	</div>

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

	<!-- <div class="data-list">
        {#each data as entry (entry.id)}
        {#each data as entry (entry.id)}
            <details>
                <summary>{entry.displayName}</summary>

                    <p><strong>ID:</strong> {entry.id}</p>
                    <p><strong>Length:</strong> {entry.datalength}</p>
    
                    <details>
                    <summary>time</summary>
                    <ul>
                        {#each entry.data.time.data.slice(0,5) as ts}
                        <li>{ts}</li>
                        {/each}
                    </ul>
                    </details>
    
                    <details>
                    <summary>values</summary>
                    <ul>
                        {#each entry.data.value.data.slice(0,5) as ts}
                        <li>{ts}</li>
                        {/each}
                    </ul>
                    </details>
                
            </details>
            
        {/each}
    </div> -->
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
