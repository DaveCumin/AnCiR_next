<script module>
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';

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

	export const editvalue_defaults = new Map([['edits', []]]);
</script>

<script>
	import Icon from '$lib/icons/Icon.svelte';

	let { p = $bindable() } = $props();

	// Initialize edits array if it doesn't exist
	$effect(() => {
		if (!p.args.edits) {
			p.args.edits = [];
		}
	});

	// Ensure values match the column type
	$effect(() => {
		if (p.parentCol.type == 'number' && p.args.edits) {
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
			value: p.parentCol.type == 'number' ? 0 : ''
		};

		p.args.edits = [...p.args.edits, newEdit];
	}

	function removeEdit(editId) {
		p.args.edits = p.args.edits.filter((e) => e.id !== editId);
	}
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

	<div class="edits-container">
		<button class="icon" onclick={addEdit}>
			<Icon name="plus" width={16} height={16} />
		</button>
		{#each p.args.edits || [] as edit (edit.id)}
			<div class="control-input-horizontal">
				<div class="control-input">
					<p>position</p>
					<input type="number" bind:value={edit.position} min="1" step="1" />
				</div>

				<div class="control-input">
					<p>value</p>
					{#if p.parentCol.type == 'time' || p.parentCol.type == 'number'}
						<NumberWithUnits bind:value={edit.value} />
					{:else if p.parentCol.type == 'category'}
						<input type="text" bind:value={edit.value} />
					{/if}
				</div>

				<button
					class="icon remove-edit"
					onclick={() => removeEdit(edit.id)}
					style="margin-top: 1rem;"
				>
					<Icon name="minus" width={16} height={16} />
				</button>
			</div>
		{/each}
	</div>
</div>
