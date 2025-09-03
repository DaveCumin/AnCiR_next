<script context="module">
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';

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
		let resultMask = new Array(x.length).fill(true);

		// Process each condition
		for (const { byColId, isOperator, byColValue } of conditions) {
			if (byColId == -1) continue; // Skip invalid column Ids

			const byCol = getColumnById(byColId);
			if (!byCol) continue; // Skip if column not found

			let byColData = [];
			if (byColId === args.parentColId) {
				byColData = x;
			} else {
				byColData = byCol.getData();
			}
			if (!byColData || byColData.length === 0) continue;

			const byColType = byCol.type;

			if (byColType === 'category') {
				for (let i = 0; i < byColData.length; i++) {
					resultMask[i] = compareValues(byColData[i], isOperator, byColValue);
				}
			} else {
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
				val: [{ byColId: -1, isOperator: '==', byColValue: 0, parentColId: -1 }]
			}
		]
	]);
</script>

<script>
	import Icon from '$lib/icons/Icon.svelte';

	let { p = $bindable() } = $props();
	p.args.parentColId = p.parentCol.id; //so we can access the parent col in the module script

	// Add a new condition
	function addCondition() {
		p.args.conditions = [...p.args.conditions, { byColId: -1, isOperator: '==', byColValue: 0 }];
	}

	// Remove a condition by index
	function removeCondition(index) {
		p.args.conditions = p.args.conditions.filter((_, i) => i !== index);
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
	{#each p.args.conditions as condition, index}
		<div class="conditions">
			<div class="second-level-condition">
				<ColumnSelector bind:value={condition.byColId} getPlotSiblings={p.parentCol} />
				<div class="operator-input">
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
				</div>
			</div>

			<div class="second-level-condition">
				{#if getColumnById(condition.byColId)?.type === 'category'}
					<input type="text" bind:value={condition.byColValue} />
				{:else if getColumnById(condition.byColId)?.type === 'time'}
					{@const condDate = condition.byColValue
						? new Date(condition.byColValue).toISOString().slice(0, 16)
						: ''}
					<!--TODO: bind a value here so it always shows in ui-->
					<input
						type="datetime-local"
						value={condDate}
						oninput={(e) => {
							condition.byColValue = Number(new Date(e.target.value));
						}}
					/>
				{:else}
					<NumberWithUnits bind:value={condition.byColValue} />
				{/if}
			</div>
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
	<button class="add-condition-button" onclick={addCondition}>Add Condition</button>
</div>

<style>
	.conditions {
		width: 100%;
		min-width: 0;

		display: flex;
		flex-direction: column;
		flex: 1 1 0;

		margin: 0;
		padding: 0;
	}
	.second-level-condition {
		width: 100%;
		display: flex;
		flex: 1 1 0;
		flex-direction: row;
		align-items: center;
		justify-content: space-between;

		margin: 0;
		padding: 0;
		gap: 0.2rem;

		font-size: 12px;
		color: var(--color-lightness-35);

		margin-bottom: 0.25rem;
	}
	.operator-input {
		width: 4rem;
	}
	.add-condition-button:hover {
		opacity: 0.9;
	}
	.add-condition-button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
