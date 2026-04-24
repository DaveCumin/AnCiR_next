<script module>
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';

	export function sub(x, args) {
		const find = args.find;
		const replace = args.replace;
		return x.map((i) => (i == find ? replace : i));
	}
	const sub_defaults = new Map([
		['find', { val: 0 }],
		['replace', { val: 0 }]
	]);

	export const definition = { displayName: 'Substitute', func: sub, defaults: sub_defaults };
</script>

<script>
	import ProcessShell from '$lib/core/ProcessShell.svelte';

	let { p = $bindable() } = $props();
	$effect(() => {
		if (p.parentCol.type == 'number') {
			p.args.find = Number(p.args.find) || 0;
			p.args.replace = Number(p.args.replace) || 0;
		}
	});
</script>

<!-- TODO: consider what this should be. Either the replace is for the value, or (more sensibly) it is a replace part of the original string (to change the year, eg), which needs some implementation thought -->
<ProcessShell {p} title="Substitute">
	{#if p.parentCol.type == 'number' || p.parentCol.type == 'time'}
		<div class="control-input-horizontal">
			<div class="control-input">
				<p>Find</p>
				<NumberWithUnits bind:value={p.args.find} />
			</div>
			<div class="control-input">
				<p>Replace</p>
				<NumberWithUnits bind:value={p.args.replace} />
			</div>
		</div>
	{/if}

	{#if p.parentCol.type == 'category'}
		<div class="control-input-horizontal">
			<div class="control-input">
				<p>Find</p>
				<input type="text" bind:value={p.args.find} />
			</div>
			<div class="control-input">
				<p>Replace</p>
				<input type="text" bind:value={p.args.replace} />
			</div>
		</div>
	{/if}

	{#if p.parentCol.type == 'bin'}
		<div class="control-input-horizontal">
			<p>Substitution not supported for binned columns, sorry</p>
		</div>
	{/if}
</ProcessShell>

<style>
</style>
