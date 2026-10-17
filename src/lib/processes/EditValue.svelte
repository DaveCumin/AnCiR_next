<script module>
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import ControlInput from '$lib/components/inputs/ControlInput.svelte';
	import { dataEnteringProcess } from '$lib/core/processInput.js';
	import { parseCellEntry, parseNumberEntry } from '$lib/utils/cellEntry.js';

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

	// Ensure values match the column type. A blank or unreadable value is MISSING (null), never
	// 0: `Number(v) || 0` used to turn a cleared cell into a real zero as soon as this panel
	// mounted (STAT-15). Writes only what changes, so an untouched list records no undo step.
	$effect(() => {
		if (p.inputCol?.type == 'number' && p.args.edits) {
			p.args.edits.forEach((edit) => {
				const position = Number(edit.position) || 0;
				if (edit.position !== position) edit.position = position;
				const parsed = parseNumberEntry(edit.value);
				const value = parsed.ok ? parsed.value : null;
				if (edit.value !== value) edit.value = value;
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
			// Starts as missing (null) until a value is typed, rather than a silent 0.
			value: p.inputCol?.type == 'time' ? 0 : null
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
				<ControlInput label="Position">
					<input type="number" bind:value={edit.position} min="1" step="1" />
				</ControlInput>

				<ControlInput label="Value">
					{#if p.inputCol?.type == 'number'}
						<!-- Empty means missing (null), not 0; a blank box stays blank. -->
						<input
							type="number"
							step="any"
							placeholder="missing"
							value={edit.value ?? ''}
							oninput={(e) => {
								// A half-typed entry ("-", "1e") reads as '' with badInput set: not a clear.
								if (e.currentTarget.validity?.badInput) return;
								const parsed = parseNumberEntry(e.currentTarget.value);
								if (parsed.ok) edit.value = parsed.value;
							}}
						/>
					{:else if p.inputCol?.type == 'time'}
						<NumberWithUnits bind:value={edit.value} />
					{:else if p.inputCol?.type == 'category'}
						<input
							type="text"
							placeholder="missing"
							value={edit.value ?? ''}
							oninput={(e) =>
								(edit.value = parseCellEntry('category', e.currentTarget.value).value)}
						/>
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
