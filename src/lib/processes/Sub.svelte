<script module>
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import ControlInput from '$lib/components/inputs/ControlInput.svelte';

	/** A number, or a numeric (non-blank) string, as a number; anything else is null. */
	function asNumber(v) {
		if (typeof v === 'number') return v;
		if (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) return Number(v);
		return null;
	}

	/**
	 * Whether cell `v` is the value `find`. Loose where it helps ('2' is 2, null is
	 * undefined) but not JavaScript's `==`, under which '' == 0 and ' ' == 0: with the
	 * default find of 0 every blank cell was "found" and replaced, turning missing data into
	 * a value (review STAT-6 follow-up). NaN matches nothing, as before.
	 */
	export function subMatches(v, find) {
		if (find == null) return v == null;
		if (v == null) return false;
		const a = asNumber(v);
		const b = asNumber(find);
		if (a !== null && b !== null) return a === b;
		return String(v) === String(find);
	}

	export function sub(x, args) {
		const find = args.find;
		const replace = args.replace;
		return x.map((i) => (subMatches(i, find) ? replace : i));
	}
	const sub_defaults = new Map([
		['find', { val: 0 }],
		['replace', { val: 0 }]
	]);

	export const definition = {
		displayName: 'Substitute',
		func: sub,
		defaults: sub_defaults,
		nodeSpec: {
			id: 'process.substitute',
			// `disallowTypes` blocks wiring a column of that type into this input
			// (enforced in WorkflowEditor.applyConnection). Time is blocked for now:
			// Substitute matches the raw UNIX-ms value, which is meaningless for times
			// — see "Known Issues and TODOs" until the behaviour is redesigned.
			inputs: [{ name: 'input', kind: 'column', cardinality: 'one', disallowTypes: ['time'] }],
			outputs: [{ name: 'output', kind: 'column', cardinality: 'one' }]
		}
	};
</script>

<script>
	import ProcessShell from '$lib/core/ProcessShell.svelte';

	let { p = $bindable() } = $props();
	$effect(() => {
		if (p.inputCol?.type == 'number') {
			p.args.find = Number(p.args.find) || 0;
			p.args.replace = Number(p.args.replace) || 0;
		}
	});
</script>

<!-- TODO: consider what this should be. Either the replace is for the value, or (more sensibly) it is a replace part of the original string (to change the year, eg), which needs some implementation thought -->
<ProcessShell {p} title="Substitute">
	{#if p.inputCol?.type == 'number' || p.inputCol?.type == 'time'}
		<div class="control-input-horizontal">
			<ControlInput label="Find">
				<NumberWithUnits bind:value={p.args.find} />
			</ControlInput>
			<ControlInput label="Replace">
				<NumberWithUnits bind:value={p.args.replace} />
			</ControlInput>
		</div>
	{/if}

	{#if p.inputCol?.type == 'category'}
		<div class="control-input-horizontal">
			<ControlInput label="Find">
				<input type="text" bind:value={p.args.find} />
			</ControlInput>
			<ControlInput label="Replace">
				<input type="text" bind:value={p.args.replace} />
			</ControlInput>
		</div>
	{/if}

	{#if p.inputCol?.type == 'bin'}
		<div class="control-input-horizontal">
			<p>Substitution not supported for binned columns, sorry</p>
		</div>
	{/if}
</ProcessShell>

<style>
</style>
