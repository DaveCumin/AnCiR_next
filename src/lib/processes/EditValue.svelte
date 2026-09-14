<script module>
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import ControlInput from '$lib/components/inputs/ControlInput.svelte';
	import { dataEnteringProcess } from '$lib/core/processInput.js';

	export function editvalue(x, args) {
		const edits = args.edits || [];
		// Create a copy of the array to avoid mutating the original
		const result = [...x];

		// Apply each edit
		edits.forEach((edit) => {
			const pos = Number(edit.position) - 1;
			if (pos >= 0 && pos < result.length) {
				result[pos] = edit.value;
			}
		});

		return result;
	}

	const editvalue_defaults = new Map([['edits', []]]);

	/**
	 * Out-of-range-edit warning for the node's ⚠ badge (processWarnings.js).
	 * The compute above is UNCHANGED — an edit whose position is 0, fractional,
	 * or past the end of the column still changes nothing — this message just
	 * says which edits are dead. Pure, so it is unit-testable without a session.
	 */
	export function editvalueWarnings(x, args) {
		const edits = args.edits ?? [];
		if (edits.length === 0) return [];
		const n = x.length;
		const dead = edits.filter((edit) => {
			const pos = Number(edit.position);
			return !(Number.isInteger(pos) && pos >= 1 && pos <= n);
		}).length;
		if (dead === 0) return [];
		return [
			`${dead} of ${edits.length} edit${edits.length === 1 ? '' : 's'} point${dead === 1 ? 's' : ''} ` +
				`outside the input column (positions are 1-based row numbers, and this column has ` +
				`${n} rows), so ${dead === 1 ? 'it changes' : 'they change'} nothing. Set each position ` +
				`between 1 and ${n}, or delete the unused edits.`
		];
	}

	export const definition = {
		displayName: 'Edit value',
		func: editvalue,
		defaults: editvalue_defaults,
		// Free-process warnings channel: derived at render time by the node
		// components (processWarnings.js), never stored, so it cannot go stale.
		getWarnings: (p) => {
			const inData = dataEnteringProcess(p);
			if (!inData) return [];
			return editvalueWarnings(inData, p.args);
		},
		nodeSpec: {
			id: 'process.editvalue',
			inputs: [{ name: 'input', kind: 'column', cardinality: 'one' }],
			outputs: [{ name: 'output', kind: 'column', cardinality: 'one' }]
		}
	};
</script>

<script>
	import Icon from '$lib/icons/Icon.svelte';
	import ProcessShell from '$lib/core/ProcessShell.svelte';

	let { p = $bindable() } = $props();

	// Initialize edits array if it doesn't exist
	$effect(() => {
		if (!p.args.edits) {
			p.args.edits = [];
		}
	});

	// Ensure values match the column type
	$effect(() => {
		if (p.inputCol?.type == 'number' && p.args.edits) {
			p.args.edits.forEach((edit) => {
				edit.position = Number(edit.position) || 0;
				edit.value = Number(edit.value) || 0;
			});
		}
	});

	function addEdit() {
		if (!p.args.edits) {
			p.args.edits = [];
		}

		const newEdit = {
			id: crypto.randomUUID(),
			position: 1,
			value: p.inputCol?.type == 'number' ? 0 : ''
		};

		p.args.edits = [...p.args.edits, newEdit];
	}

	function removeEdit(editId) {
		p.args.edits = p.args.edits.filter((e) => e.id !== editId);
	}
</script>

<ProcessShell {p}>
	<div class="edits-container">
		<button class="icon" onclick={addEdit}>
			<Icon name="add" width={16} height={16} />
		</button>
		{#each p.args.edits || [] as edit (edit.id)}
			<div class="control-input-horizontal">
				<ControlInput label="position">
					<input type="number" bind:value={edit.position} min="1" step="1" />
				</ControlInput>

				<ControlInput label="value">
					{#if p.inputCol?.type == 'time' || p.inputCol?.type == 'number'}
						<NumberWithUnits bind:value={edit.value} />
					{:else if p.inputCol?.type == 'category'}
						<input type="text" bind:value={edit.value} />
					{/if}
				</ControlInput>

				<button
					class="icon remove-edit"
					onclick={() => removeEdit(edit.id)}
					style="margin-top: var(--space-6);"
				>
					<Icon name="trash" width={16} height={16} />
				</button>
			</div>
		{/each}
	</div>
</ProcessShell>
