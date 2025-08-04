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
	import Icon from '$lib/icons/Icon.svelte';

	let { p = $bindable() } = $props();
	$effect(() => {
		if (p.parentCol.type == 'number') {
			p.args.find = Number(p.args.find) || 0;
			p.args.replace = Number(p.args.replace) || 0;
		}
	});
</script>

<!-- TODO: consider what this should be. Either the replace is for the value, or (more sensibly) it is a replace part of the original string (to change the year, eg), which needs some implementation thought -->
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
	{#if p.parentCol.type == 'time'}
		<div class="control-input-horizontal">
			<div class="control-input">
				<p>find</p>
				<input type="number" bind:value={p.args.find} />
			</div>
			<div class="control-input">
				<p>replace</p>
				<input type="number" bind:value={p.args.replace} />
			</div>
		</div>
	{/if}

	{#if p.parentCol.type == 'number'}
		<div class="control-input-horizontal">
			<div class="control-input">
				<p>find</p>
				<input type="number" bind:value={p.args.find} />
			</div>
			<div class="control-input">
				<p>replace</p>
				<input type="number" bind:value={p.args.replace} />
			</div>
		</div>
	{/if}

	{#if p.parentCol.type == 'category'}
		<div class="control-input-horizontal">
			<div class="control-input">
				<p>find</p>
				<input type="text" bind:value={p.args.find} />
			</div>
			<div class="control-input">
				<p>replace</p>
				<input type="text" bind:value={p.args.replace} />
			</div>
		</div>
	{/if}
</div>

<style>
</style>
