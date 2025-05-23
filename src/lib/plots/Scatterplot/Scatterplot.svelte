<!-- src/lib/plots/scatter/Scatterplot.svelte -->
<script context="module">
	import { Column } from '$lib/core/Column.svelte';
	import { Process } from '$lib/core/Process.svelte';
	import { core } from '$lib/core/theCore.svelte.js';

	function getRandomColor() {
		const letters = '0123456789ABCDEF';
		let color = '#';
		for (let i = 0; i < 6; i++) {
			color += letters[Math.floor(Math.random() * 16)];
		}
		return color;
	}

	class ScatterDataclass {
		parent = $state();
		x = $state();
		y = $state();
		colour = $state(getRandomColor());
		polyline = $derived.by(() => {
			const tempx = this.x?.getData() ?? [];
			const tempy = this.y?.getData() ?? [];
			if (tempx.length === 0 || tempy.length === 0) return '';

			const xmax = Math.max(...tempx) || 1; // Avoid division by zero
			const ymax = Math.max(...tempy) || 1;
			let out = '';
			for (let p = 0; p < Math.min(tempx.length, tempy.length); p++) {
				out +=
					(this.parent.width * tempx[p]) / xmax +
					',' +
					(this.parent.height - (this.parent.height * tempy[p]) / ymax) +
					' ';
			}
			return out.trim();
		});

		constructor(parent, dataIN) {
			this.parent = parent;
			this.x = dataIN?.x
				? Column.fromJSON(dataIN.x)
				: new Column({ refDataID: this.getValidColumnID() });
			this.y = dataIN?.y
				? Column.fromJSON(dataIN.y)
				: new Column({ refDataID: this.getValidColumnID() });
		}

		getValidColumnID() {
			const options = Array.from(core.data.keys());
			return options.length > 0 ? options[Math.floor(Math.random() * options.length)] : -1;
		}

		toJSON() {
			return {
				x: this.x.toJSON(),
				y: this.y.toJSON(),
				colour: this.colour
			};
		}

		static fromJSON(json, parent) {
			return new ScatterDataclass(parent, {
				x: json.x,
				y: json.y
			});
		}
	}

	export class Scatterplotclass {
		width = $state(400);
		height = $state(100);
		data = $state([]);
		ylims = $derived.by(() => {
			let ymin = Infinity;
			let ymax = -Infinity;
			for (const d of this.data) {
				const tempy = d.y?.getData() ?? [];
				if (tempy.length > 0) {
					ymin = Math.min(ymin, Math.min(...tempy));
					ymax = Math.max(ymax, Math.max(...tempy));
				}
			}
			return [ymin === Infinity ? 0 : ymin, ymax === -Infinity ? 1 : ymax];
		});

		constructor(width, height, dataIN) {
			this.width = width || 400;
			this.height = height || 100;
			if (dataIN) {
				this.addData(dataIN);
			}
		}

		addData(dataIN) {
			this.data = [...this.data, new ScatterDataclass(this, dataIN)];
		}

		removeData(idx) {
			this.data = this.data.filter((_, i) => i !== idx);
		}

		toJSON() {
			return {
				width: this.width,
				height: this.height,
				data: this.data.map((d) => d.toJSON())
			};
		}

		static fromJSON(json) {
			if (!json) {
				return new Scatterplotclass(400, 100);
			}
			const { width, height, data } = json;
			const scatter = new Scatterplotclass(width, height);
			if (data) {
				scatter.data = data.map((d) => ScatterDataclass.fromJSON(d, scatter));
			}
			return scatter;
		}
	}
</script>

<script>
	let { theData = $bindable(), which = 'plot' } = $props();

	function pickRandomData() {
		const options = Array.from(core.data.keys());
		return options.length > 0 ? options[Math.floor(Math.random() * options.length)] : -1;
	}
</script>

{#snippet controls(theData)}
	<div>
		<p>{JSON.stringify(theData)}</p>
		<p>Data:</p>
		<button
			on:click={() =>
				theData.addData({
					x: { refDataID: pickRandomData() },
					y: { refDataID: pickRandomData() }
				})}
		>
			+
		</button>
		<p>ylims: {theData.ylims}</p>
		{#each theData.data as datum, i}
			<p>
				Data {i} ({JSON.stringify(datum)})
				<button on:click={() => theData.removeData(i)}>-</button>
			</p>
			<p>
				x: {datum.x.name} ({datum.x.getData()?.join(', ')})
				<input type="number" bind:value={datum.x.refDataID} />
				<button on:click={() => datum.x.addProcess(Math.random() > 0.5 ? 'add' : 'sub')}>
					Add process
				</button>
			</p>
			{#each datum.x.processes as p}
				<div>
					{p.processid} - {p.name}
					{#each Object.keys(p.args.values) as arg}
						{arg} ({datum.x.getProcessArgType(p.name, arg)}):
						{#if datum.x.getProcessArgType(p.name, arg) === 'number'}
							<input type="number" bind:value={p.args.values[arg]} />
						{:else if datum.x.getProcessArgType(p.name, arg) === 'category'}
							<input type="text" bind:value={p.args.values[arg]} />
						{/if}
					{/each}
					<button on:click={() => datum.x.removeProcess(p.processid)}>-</button>
				</div>
			{/each}
			<p>
				y: {datum.y.name} ({datum.y.getData()?.join(', ')})
				<input type="number" bind:value={datum.y.refDataID} />
				<button on:click={() => datum.y.addProcess(Math.random() > 0.5 ? 'add' : 'sub')}>
					Add process
				</button>
			</p>
			{#each datum.y.processes as p}
				<div>
					{p.processid} - {p.name}
					{#each Object.keys(p.args.values) as arg}
						{arg} ({datum.y.getProcessArgType(p.name, arg)}):
						{#if datum.y.getProcessArgType(p.name, arg) === 'number'}
							<input type="number" bind:value={p.args.values[arg]} />
						{:else if datum.y.getProcessArgType(p.name, arg) === 'category'}
							<input type="text" bind:value={p.args.values[arg]} />
						{/if}
					{/each}
					<button on:click={() => datum.y.removeProcess(p.processid)}>-</button>
				</div>
			{/each}
			<input type="color" bind:value={datum.colour} />
		{/each}
	</div>
{/snippet}

{#snippet plot(theData)}
	<p>{JSON.stringify(theData)}</p>
	<!-- <svg width={theData.width} height={theData.height} style="background: grey;">
		{#each theData.data as datum}
			{#if datum.polyline}
				<polyline fill="none" stroke={datum.colour} stroke-width="3" points={datum.polyline} />
			{/if}
		{/each}
	</svg>
	-->
{/snippet}

{#if which === 'plot'}
	{@render plot(theData)}
{:else if which === 'controls'}
	{@render controls(theData)}
{/if}
