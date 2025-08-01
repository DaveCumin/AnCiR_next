<script module>
	export function add(x, args) {
		const value = args.value;
		return x.map((i) => i + value);
	}
	export const add_defaults = new Map([['value', { val: 0 }]]);
</script>

<script>
	import Icon from "$lib/icons/Icon.svelte";
	
	let { p = $bindable() } = $props();
</script>

<div class="control-input process">
	<div class="process-title">
		<p>{p.name}</p>
		<button class="icon" onclick={(e) => {e.stopPropagation(); col.removeProcess(p.id);}}>
			<Icon name="minus" width={16} height={16} className="control-component-icon"/>
		</button>
	</div>
	<input type="number" bind:value={p.args.value} />
</div>

<style>
	.process {
		margin: 0.25rem 0;
	}

	.process-title {
		width: 100%;
		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: space-between;

		margin: 0;
		padding: 0;
	}

	.process-title button {
		margin: 0 0 0 0;
		padding: 0;
	}
</style>
