<script module>
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';

	export function add(x, args) {
		const value = Number(args.value);
		return x.map((i) => i + value);
	}
	export const add_defaults = new Map([['value', { val: Number(0) }]]);
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
	<NumberWithUnits bind:value={p.args.value} />
</div>

<style>
</style>
