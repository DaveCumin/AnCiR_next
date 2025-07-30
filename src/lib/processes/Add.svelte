<script module>
	export function add(x, args) {
		const value = args.value;
		return x.map((i) => i + value);
	}
	export const add_defaults = new Map([['value', { val: 0 }]]);
</script>

<script>
	let { p = $bindable() } = $props();
</script>

<p>
	{p.id} - {p.name} <input type="number" bind:value={p.args.value} />
</p>
