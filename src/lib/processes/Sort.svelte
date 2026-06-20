<script module>
	// @ts-nocheck
	export function sort(x, args) {
		const direction = args?.direction ?? 'asc';
		const isMissing = (v) => v == null || (typeof v === 'number' && isNaN(v));
		const present = [];
		const missing = [];
		for (const v of x) (isMissing(v) ? missing : present).push(v);
		if (present.length > 0 && typeof present[0] === 'number') {
			present.sort((a, b) => (direction === 'desc' ? b - a : a - b));
		} else {
			present.sort((a, b) => {
				const cmp = String(a).localeCompare(String(b));
				return direction === 'desc' ? -cmp : cmp;
			});
		}
		return [...present, ...missing];
	}

	const sort_defaults = new Map([['direction', { val: 'asc' }]]);

	export const definition = {
		displayName: 'Sort',
		func: sort,
		defaults: sort_defaults,
		nodeSpec: {
			id: 'process.sort',
			inputs: [{ name: 'input', kind: 'column', cardinality: 'one' }],
			outputs: [{ name: 'output', kind: 'column', cardinality: 'one' }]
		}
	};
</script>

<script>
	import ProcessShell from '$lib/core/ProcessShell.svelte';

	let { p = $bindable() } = $props();

	const directions = [
		{ value: 'asc', label: 'Ascending' },
		{ value: 'desc', label: 'Descending' }
	];
</script>

<ProcessShell {p}>
	<div class="control-input">
		<select bind:value={p.args.direction}>
			{#each directions as d}
				<option value={d.value}>{d.label}</option>
			{/each}
		</select>
	</div>
</ProcessShell>

<style>
	select {
		width: 100%;
		padding: var(--space-2);
		border: 1px solid var(--border-color, #ccc);
		border-radius: 0.25rem;
		font-size: 0.9rem;
	}
</style>
