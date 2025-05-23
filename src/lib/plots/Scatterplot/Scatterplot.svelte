<script>
	import { onMount } from 'svelte';
	let { theData = $bindable() } = $props();

	import { core } from '$lib/core/theCore.svelte.js';
	function pickRandomData() {
		const options = core.data.map((d) => {
			return d.columnID;
		});
		return options[Math.round(Math.random() * 1000, 2) % options.length];
	}
</script>

<!-- //TODO: How best to make the controls separate from the plot? [need a new component?] -->
<div>
	width: <input type="number" bind:value={theData.width} />
	height: <input type="number" bind:value={theData.height} />
	<p>Data:</p>
	<button onclick={() => theData.addData()}>+</button>
	<p>ylims: {theData.ylims}</p>
	{#each theData.data as datum, i}
		<p>
			Data {i} ({JSON.stringify(datum)})
			<button onclick={() => theData.removeData(i)}>-</button>
		</p>
		<p>
			x: {datum.x.name} ({datum.x.getData()}) <input type="number" bind:value={datum.x.refDataID} />
			<button onclick={() => datum.x.addProcess(Math.random() > 0.5 ? 'add' : 'sub')}
				>Add process</button
			>
		</p>

		{#each datum.x.processes as p}
			<!--
			<div>
				{p.id}
				{p.name} -
				{#each Object.keys(p.args) as arg}
					{arg} ({datum.x.getProcessArgType(p.name, arg)}):
					{#if datum.x.getProcessArgType(p.name, arg) === 'number'}
						<input type="number" bind:value={p.args[arg]} />
					{:else if datum.x.getProcessArgType(p.name, arg) === 'category'}
						<input type="text" bind:value={p.args[arg]} />
					{/if}
				{/each}
				<button onclick={() => datum.x.removeProcess(p.processid)}>-</button>
			</div>
			-->
			{p.id}
			{p.name} -
		{/each}

		<p>
			y: {datum.y.name} ({datum.y.getData()}) <input type="number" bind:value={datum.y.refDataID} />
			<button onclick={() => datum.y.addProcess(Math.random() > 0.5 ? 'add' : 'sub')}
				>Add process</button
			>
		</p>
		{#each datum.y.processes as p}
			<!-- 
			<div>
				{p.id}
				{p.name} -
				{#each Object.keys(p.args) as arg}
					{arg} ({datum.y.getProcessArgType(p.name, arg)}):
					{#if datum.x.getProcessArgType(p.name, arg) === 'number'}
						<input type="number" bind:value={p.args[arg]} />
					{:else if datum.y.getProcessArgType(p.name, arg) === 'category'}
						<input type="text" bind:value={p.args[arg]} />
					{/if}
				{/each}
				<button onclick={() => datum.y.removeProcess(p.processid)}>-</button>
			</div>
			-->
			{p.id}
			{p.name} -
		{/each}
		<input type="color" bind:value={datum.colour} />
	{/each}
	<br />
	<!-- //TODO: Carefully consider plotting. Layercake? -->
	<svg width={theData.width} height={theData.height} style="background: grey;">
		{#each theData.data as datum}
			<polyline fill="none" stroke={datum.colour} stroke-width="3" points={datum.polyline} />
		{/each}
	</svg>
</div>

<hr />
