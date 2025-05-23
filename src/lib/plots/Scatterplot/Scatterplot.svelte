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
			let out = '';
			let tempx = this.x.getData() ?? [];
			let tempy = this.y.getData() ?? [];

			const xmax = Math.max(...tempx);
			const ymax = Math.max(...tempy);

			console.log(
				'ylims: ',
				this.parent.ylims,
				'width: ',
				this.parent.parent.width,
				', or ',
				this.parent.width
			);
			for (let p = 0; p < tempx.length; p++) {
				out +=
					(this.parent.parent.width * tempx[p]) / xmax +
					',' +
					(this.parent.parent.height -
						(this.parent.parent.height * tempy[p]) / this.parent.ylims[1]) +
					' ';
			}

			return out;
		});

		constructor(parent, dataIN) {
			this.parent = parent;

			if (dataIN && dataIN.x) {
				this.x = Column.fromJSON(dataIN.x);
			} else {
				this.x = new Column({ refDataID: -1 });
			}
			if (dataIN && dataIN.y) {
				this.y = Column.fromJSON(dataIN.y);
			} else {
				this.y = new Column({ refDataID: -1 });
			}
		}

		toJSON() {
			return {
				x: this.x,
				y: this.y,
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
		parent = $state();
		data = $state([]);
		ylims = $derived.by(() => {
			let ymin = Infinity;
			let ymax = -Infinity;
			this.data.forEach((d, i) => {
				let tempy = this.data[i].y.getData() ?? [];
				ymin = Math.min(ymin, Math.min(...tempy));
				ymax = Math.max(ymax, Math.max(...tempy));
			});
			return [ymin, ymax];
		});

		constructor(parent, dataIN) {
			this.parent = parent;
			if (dataIN) {
				this.addData(dataIN);
			}
		}

		addData(dataIN) {
			console.log('din: ', dataIN);
			this.data.push(new ScatterDataclass(this, dataIN));
		}
		removeData(idx) {
			this.data.splice(idx, 1);
		}

		toJSON() {
			return {
				data: this.data
			};
		}
		static fromJSON(json) {
			if (!json) {
				return new Scatterplotclass();
			}
			//TODO: fix this.
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
	let { theData, which } = $props();

	function pickRandomData() {
		const options = Array.from(core.data.keys());
		return options.length > 0 ? options[Math.floor(Math.random() * options.length)] : -1;
	}
</script>

{#snippet controls(theData)}
	<div>
		<p>controls: {JSON.stringify(theData)}; Parent: {theData.parent}</p>
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
	<p>{theData.data[0].polyline}</p>
	<svg width={theData.width} height={theData.height} style="background: grey;">
		{#each theData.data as datum}
			{#if datum.polyline}
				<polyline fill="none" stroke={datum.colour} stroke-width="3" points={datum.polyline} />
			{/if}
		{/each}
	</svg>
{/snippet}

{#if which === 'plot'}
	{@render plot(theData)}
{:else if which === 'controls'}
	{@render controls(theData)}
{/if}
