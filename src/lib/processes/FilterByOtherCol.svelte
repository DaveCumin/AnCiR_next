<script context="module">
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';
	import { getColumnById } from '$lib/core/Column.svelte';

	function compareValues(value, operator, target) {
		switch (operator) {
			case '==':
				return value == target;
			case '!=':
				return value != target;
			case '>':
				return value > target;
			case '<':
				return value < target;
			case '>=':
				return value >= target;
			case '<=':
				return value <= target;
			case 'includes':
				return value?.includes?.(target) || false;
			case 'notincludes':
				return !value?.includes?.(target) || false;
			default:
				return false;
		}
	}

	export function filterbyothercol(x, args) {
		const { conditions } = args;

		// If no conditions or invalid, return original array
		if (!conditions || conditions.length === 0) return x;

		// Initialize result mask (false for all elements initially for OR logic)
		let resultMask = new Array(x.length).fill(false);

		// Process each condition
		for (const { byColId, isOperator, byColValue } of conditions) {
			if (byColId == -1) continue; // Skip invalid column Ids

			const byCol = getColumnById(byColId);
			if (!byCol) continue; // Skip if column not found

			const byColType = byCol.type;

			if (byColType === 'category') {
				const byColData = byCol.getData();
				for (let i = 0; i < byColData.length; i++) {
					resultMask[i] = compareValues(byColData[i], isOperator, byColValue);
				}
			} else if (byColType === 'time') {
				const byColData = byCol.hoursSinceStart;
				for (let i = 0; i < byColData.length; i++) {
					resultMask[i] = compareValues(Number(byColData[i]), isOperator, Number(byColValue));
				}
			} else {
				const byColData = byCol.getData();
				for (let i = 0; i < byColData.length; i++) {
					resultMask[i] = compareValues(Number(byColData[i]), isOperator, Number(byColValue));
				}
			}
		}

		// Apply mask to filter x
		const out = x.map((val, i) => (resultMask[i] ? val : NaN));
		return out;
	}

	export const filterbyothercol_defaults = new Map([
		[
			'conditions',
			{
				val: [{ byColId: -1, isOperator: '==', byColValue: 0 }]
			}
		]
	]);
</script>

<script>
	let { p = $bindable() } = $props();

	// Add a new condition
	function addCondition() {
		p.args.conditions = [...p.args.conditions, { byColId: -1, isOperator: '==', byColValue: 0 }];
	}

	// Remove a condition by index
	function removeCondition(index) {
		p.args.conditions = p.args.conditions.filter((_, i) => i !== index);
	}
</script>

<div>
	<p>{p.id} - {p.name}</p>
	{#each p.args.conditions as condition, index}
		<div class="conditions">
			<span>Where</span>
			<ColumnSelector
				bind:value={condition.byColId}
				excludeColIds={[p.parentCol.id, p.parentCol.refDataId]}
			/>
			<span>is</span>
			{#if getColumnById(condition.byColId)?.type === 'category'}
				<select bind:value={condition.isOperator}>
					<option value="==">equals</option>
					<option value="!=">not equals</option>
					<option value="includes">includes</option>
					<option value="notincludes">does not include</option>
				</select>
			{:else}
				<select bind:value={condition.isOperator}>
					<option value="==">=</option>
					<option value="!=">!=</option>
					<option value=">">&gt;</option>
					<option value="<">&lt;</option>
					<option value=">=">≥</option>
					<option value="<=">≤</option>
				</select>
			{/if}
			{#if getColumnById(condition.byColId)?.type === 'category'}
				<input type="text" bind:value={condition.byColValue} />
			{:else}
				<input type="number" bind:value={condition.byColValue} />
			{/if}
			{#if p.args.conditions.length > 1}
				<button onclick={() => removeCondition(index)} disabled={p.args.conditions.length <= 1}>
					Remove
				</button>
			{/if}
			{#if p.args.conditions.length > 1 && index < p.args.conditions.length - 1}
				<p>or</p>
			{/if}
		</div>
	{/each}
	<button onclick={addCondition}> Add Condition </button>
</div>

<style>
	button:hover {
		opacity: 0.9;
	}
	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
