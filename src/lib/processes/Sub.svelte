<script module>
	export function sub(x, args) {
		const find = args.find;
		const replace = args.replace;
		return x.map((i) => (i == find ? replace : i));
	}
	export const sub_defaults = new Map([
		['find', { val: 0, type: 'dataType' }],
		['replace', { val: 0, type: 'dataType' }]
	]);
</script>

<script>
	let { p = $bindable() } = $props();
	$effect(() => {
		if (p.parentCol.type == 'number') {
			p.args.find = Number(p.args.find) || 0;
			p.args.replace = Number(p.args.replace) || 0;
		}
	});
</script>

{#if p.parentCol.type == 'number'}
	<p>
		{p.processid} - {p.name} find:<input type="number" bind:value={p.args.find} /> replace:
		<input type="number" bind:value={p.args.replace} />
	</p>
{/if}
{#if p.parentCol.type == 'category'}
	<p>
		{p.parentCol.type}
		{p.processid} - {p.name} find:<input type="text" bind:value={p.args.find} /> replace:
		<input type="text" bind:value={p.args.replace} />
	</p>
{/if}
