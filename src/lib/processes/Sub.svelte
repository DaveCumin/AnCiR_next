<script module>
	export function sub(x, args) {
		const find = args.find;
		const replace = args.replace;
		return x.map((i) => (i == find ? replace : i));
	}
	export const sub_defaults = new Map([
		['find', { val: 0 }],
		['replace', { val: 0 }]
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

<!-- TODO: consider what this should be. Either the replace is for the value, or (more sensibly) it is a replace part of the original string (to change the year, eg), which needs some implementation thought -->
{#if p.parentCol.type == 'time'}
	<p>
		{p.id} - {p.name} find:<input type="number" bind:value={p.args.find} /> replace:
		<input type="number" bind:value={p.args.replace} />
	</p>
{/if}

{#if p.parentCol.type == 'number'}
	<p>
		{p.id} - {p.name} find:<input type="number" bind:value={p.args.find} /> replace:
		<input type="number" bind:value={p.args.replace} />
	</p>
{/if}

{#if p.parentCol.type == 'category'}
	<p>
		{p.id} - {p.name} find:<input type="text" bind:value={p.args.find} /> replace:
		<input type="text" bind:value={p.args.replace} />
	</p>
{/if}
