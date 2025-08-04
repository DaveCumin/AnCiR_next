<script module>
	export function multiply(x, args) {
		const value = args.value;
		return x.map((i) => i * value);
	}
	export const mulitply_defaults = new Map([['value', { val: 1 }]]);
</script>

<script>
	import Icon from '$lib/icons/Icon.svelte';

	let { p = $bindable() } = $props();
</script>

<div class="control-input process">
	<div class="process-title">
		<p>{p.name}</p>
		<button
			class="icon"
			onclick={(e) => {
				e.stopPropagation();
				p.parentCol.removeProcess(p.id);
			}}
		>
			<Icon name="minus" width={16} height={16} className="control-component-title-icon" />
		</button>
	</div>
	<input type="number" bind:value={p.args.value} />
</div>

<style>
</style>
