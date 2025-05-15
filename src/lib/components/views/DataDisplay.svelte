<script>
	// import CollapsibleSection from '$lib/ui/CollapsibleSection.svelte';
	import Icon from '$lib/icon/Icon.svelte';
	import { DateTime } from 'luxon';

	// import { generateData } from '$lib/data/simulate';
	import { data } from '$lib/store.svelte.js';
	import { DataItem } from '$lib/models/dataItem.svelte';
	import { TestDataItem } from '$lib/models/testDataItem.svelte';

	// manual handle simulate
	function simulateData() {
		const newDataEntry = new TestDataItem(
			28,
			15,
			DateTime.now()
				.set({
					hour: 0,
					minute: 0,
					second: 0,
					millisecond: 0
				})
				.toJSDate(),
			[24, 28],
			[100, 150],
			data.data.length
		);

		data.data = [...data.data, newDataEntry];
		console.log('items:', data.data);
		console.log(
			'new added item fields:',
			$state.snapshot(data.data[data.data.length - 1].dataField)
		);
	}

	// test reactivity
	function changeName() {
		/*
        change name of simulate_0 to happy_data
        */
		console.log($state.snapshot(data.data));
		console.log(data.data[0].displayName);
		data.data[0].changeName('happy_data' + Math.round(Math.random() * 10, 2));
		console.log(data.data[0].displayName);
	}

	function changeDataFieldContent() {
		/*
        change first data point of value0 in simulate_0 to 0318
        */
		console.log(data.data[0].dataField[1].dataArr.content[0]);
		data.data[0].dataField[1].dataArr.content[0] = 318 + Math.round(Math.random() * 10, 2);
		console.log(data.data[0].dataField[1].dataArr.content[0]);
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
		{#each data.data as entry (entry.id)}
			{#key data.data}
				<details>
					<summary>{entry.displayName}</summary>
					<p><strong>importedFrom:</strong>{entry.importedFrom}</p>
					<p><strong>Length:</strong>{entry.dataLength}</p>

					{#each entry.dataField as field (field.id)}
						<details>
							<summary>{field.type}</summary>
							<ul>
								{#each field.dataArr.content.slice(0, 5) as test}
									<li>{test}</li>
								{/each}
							</ul>
						</details>
						<details>
							<summary>testD</summary>
							<ul>
								<li>{field.testD}</li>
							</ul>
						</details>
					{/each}
				</details>
			{/key}
		{/each}
	</div>

	<div class="test">
		<button onclick={changeName}> change item name </button>

		<button onclick={changeDataFieldContent}> change data point </button>
	</div>

	<!-- <div class="data-list">
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
