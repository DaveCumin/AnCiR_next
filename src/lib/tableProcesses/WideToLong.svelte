<script module>
	// @ts-nocheck
	import { core as coreForTransform } from '$lib/core/core.svelte';
	import { getColumnById as getColumnByIdForTransform } from '$lib/core/Column.svelte';

	const displayName = 'Wide To Long';
	const defaults = new Map([
		['timeIN', { val: -1 }],
		['valueColIds', { val: [] }],
		['out', { time: { val: -1 }, category: { val: -1 }, value: { val: -1 } }],
		['valid', { val: false }]
	]);

	function isMissingValue(value) {
		return value == null || value === '' || (typeof value === 'number' && Number.isNaN(value));
	}

	function getSelectedValueColIds(argsIN) {
		const selected = [];
		const seen = Object.create(null);
		for (const rawId of argsIN.valueColIds ?? []) {
			const colId = Number(rawId);
			if (colId >= 0 && !seen[colId]) {
				seen[colId] = true;
				selected.push(colId);
			}
		}
		return selected;
	}

	export function widetolong(argsIN) {
		const timeIN = Number(argsIN.timeIN);
		const valueColIds = getSelectedValueColIds(argsIN);

		if (timeIN < 0 || valueColIds.length === 0) {
			return [{}, false];
		}

		const timeCol = getColumnByIdForTransform(timeIN);
		if (!timeCol) return [{}, false];

		const timeData = timeCol.getData();
		const result = { time: [], category: [], value: [] };

		for (const colId of valueColIds) {
			const valueCol = getColumnByIdForTransform(colId);
			if (!valueCol) return [{}, false];

			const valueData = valueCol.getData();
			const rowCount = Math.min(timeData.length, valueData.length);
			const categoryLabel = valueCol.name ?? `column_${colId}`;

			for (let rowIdx = 0; rowIdx < rowCount; rowIdx++) {
				const timeValue = timeData[rowIdx];
				const cellValue = valueData[rowIdx];
				if (isMissingValue(timeValue) || isMissingValue(cellValue)) continue;

				result.time.push(timeValue);
				result.category.push(categoryLabel);
				result.value.push(cellValue);
			}
		}

		const hasOutputCols =
			Number(argsIN.out?.time) >= 0 &&
			Number(argsIN.out?.category) >= 0 &&
			Number(argsIN.out?.value) >= 0;

		if (hasOutputCols) {
			const processHash = crypto.randomUUID();

			coreForTransform.rawData.set(argsIN.out.time, result.time);
			coreForTransform.rawData.set(argsIN.out.category, result.category);
			coreForTransform.rawData.set(argsIN.out.value, result.value);

			const outTimeCol = getColumnByIdForTransform(argsIN.out.time);
			if (outTimeCol) {
				outTimeCol.data = argsIN.out.time;
				outTimeCol.type = timeCol.type;
				if (timeCol.timeFormat) {
					outTimeCol.timeFormat = timeCol.timeFormat;
				}
				outTimeCol.tableProcessGUId = processHash;
			}

			const outCategoryCol = getColumnByIdForTransform(argsIN.out.category);
			if (outCategoryCol) {
				outCategoryCol.data = argsIN.out.category;
				outCategoryCol.type = 'category';
				outCategoryCol.tableProcessGUId = processHash;
			}

			const outValueCol = getColumnByIdForTransform(argsIN.out.value);
			if (outValueCol) {
				outValueCol.data = argsIN.out.value;
				outValueCol.type = getColumnByIdForTransform(valueColIds[0])?.type ?? 'number';
				outValueCol.tableProcessGUId = processHash;
			}
		}

		return [result, result.time.length > 0];
	}

	export const definition = { displayName, defaults, func: widetolong };
</script>

<script>
	// @ts-nocheck
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import Table from '$lib/components/plotbits/Table.svelte';
	import ColumnComponent, { Column, getColumnById } from '$lib/core/Column.svelte';
	import { core as coreState, pushObj } from '$lib/core/core.svelte.js';
	import { formatTimeFromUNIX } from '$lib/utils/time/TimeUtils.js';
	import { onMount, untrack } from 'svelte';

	let { p = $bindable() } = $props();

	let wideToLongResult = $state();
	let mounted = $state(false);
	let previewStart = $state(1);
	let errorMessage = $state('');
	let timeIN_local = $state(p.args.timeIN);
	let selectedValueColIds = $state(p.args.valueColIds ?? []);

	let timeIN_col = $derived.by(() => (p.args.timeIN >= 0 ? getColumnById(p.args.timeIN) : null));
	let valueCols = $derived.by(() =>
		(p.args.valueColIds ?? []).map((colId) => getColumnById(colId)).filter(Boolean)
	);
	let getHash = $derived.by(() => {
		let hash = '';
		hash += timeIN_col?.getDataHash ?? '';
		for (const col of valueCols) {
			hash += col?.getDataHash ?? '';
		}
		return hash;
	});
	let lastHash = '';

	let outputIds = $derived.by(() => {
		const ids = [];
		for (const ref of Object.values(p.args.out ?? {})) {
			const colId = Number(ref);
			if (colId >= 0) ids.push(colId);
		}
		return ids;
	});

	let previewTime = $derived.by(() => {
		const timeData = wideToLongResult?.time ?? [];
		if (timeIN_col?.type !== 'time') return timeData;
		return timeData.map((value) => formatTimeFromUNIX(value));
	});
	let previewTotalRows = $derived(wideToLongResult?.time?.length ?? 0);

	$effect(() => {
		const dataHash = getHash;
		if (!mounted) return;
		if (dataHash !== lastHash) {
			untrack(() => {
				doWideToLong();
			});
			lastHash = dataHash;
		}
	});

	function validateTimeInput(newVal) {
		const colId = Number(newVal);
		if (colId < 0) return null;
		if (outputIds.includes(colId)) {
			return 'That column is an output of this transform and cannot be used as an input.';
		}
		if ((p.args.valueColIds ?? []).map(Number).includes(colId)) {
			return 'That column is already selected as a wide value column.';
		}
		return null;
	}

	function validateValueSelection(newIds) {
		const normalized = [...new Set((newIds ?? []).map(Number).filter((colId) => colId >= 0))];
		if (p.args.timeIN >= 0 && normalized.includes(Number(p.args.timeIN))) {
			return 'The shared time column cannot also be used as a wide value column.';
		}
		for (const colId of normalized) {
			if (outputIds.includes(colId)) {
				return 'One or more selected columns are outputs of this transform and cannot be used as inputs.';
			}
		}
		return '';
	}

	function onTimeChange() {
		const err = validateTimeInput(timeIN_local);
		if (err) {
			errorMessage = err;
			timeIN_local = p.args.timeIN;
			return;
		}
		errorMessage = '';
		p.args.timeIN = Number(timeIN_local);
		doWideToLong();
	}

	function onValueSelectionChange(newIds) {
		const normalized = [...new Set((newIds ?? []).map(Number).filter((colId) => colId >= 0))];
		const err = validateValueSelection(normalized);
		if (err) {
			errorMessage = err;
			selectedValueColIds = [...(p.args.valueColIds ?? [])];
			return;
		}
		errorMessage = '';
		const current = (p.args.valueColIds ?? []).map(Number);
		if (
			normalized.length === current.length &&
			normalized.every((colId, idx) => colId === current[idx])
		) {
			return;
		}
		p.args.valueColIds = normalized;
		doWideToLong();
	}

	function ensureOutputColumns() {
		if (!p.parent || p.args.timeIN < 0 || (p.args.valueColIds?.length ?? 0) === 0) return;

		const outputSpecs = [
			{ key: 'time', name: `time_${p.id}` },
			{ key: 'category', name: `category_${p.id}` },
			{ key: 'value', name: `value_${p.id}` }
		];

		for (const spec of outputSpecs) {
			if (Number(p.args.out?.[spec.key]) >= 0) continue;
			const tempCol = new Column({});
			tempCol.name = spec.name;
			pushObj(tempCol);
			p.parent.columnRefs = [tempCol.id, ...p.parent.columnRefs];
			p.args.out[spec.key] = tempCol.id;
		}
	}

	function doWideToLong() {
		previewStart = 1;
		ensureOutputColumns();
		[wideToLongResult, p.args.valid] = widetolong(p.args);
	}

	onMount(() => {
		if (p.args.timeIN === undefined) p.args.timeIN = -1;
		if (!p.args.valueColIds) p.args.valueColIds = [];
		if (!p.args.out) p.args.out = { time: -1, category: -1, value: -1 };
		if (p.args.out.time === undefined) p.args.out.time = -1;
		if (p.args.out.category === undefined) p.args.out.category = -1;
		if (p.args.out.value === undefined) p.args.out.value = -1;

		const hasStoredOutputs =
			Number(p.args.out.time) >= 0 &&
			Number(p.args.out.category) >= 0 &&
			Number(p.args.out.value) >= 0 &&
			coreState.rawData.has(p.args.out.time) &&
			coreState.rawData.has(p.args.out.category) &&
			coreState.rawData.has(p.args.out.value) &&
			coreState.rawData.get(p.args.out.time).length > 0;

		if (hasStoredOutputs) {
			wideToLongResult = {
				time: coreState.rawData.get(p.args.out.time),
				category: coreState.rawData.get(p.args.out.category),
				value: coreState.rawData.get(p.args.out.value)
			};
			p.args.valid = true;
			lastHash = getHash;
		}

		timeIN_local = p.args.timeIN;
		selectedValueColIds = [...(p.args.valueColIds ?? [])];
		mounted = true;
	});
</script>

<div class="section-row">
	<div class="tableProcess-label"><span>Time column</span></div>
	<ColumnSelector bind:value={timeIN_local} onChange={onTimeChange} excludeColIds={outputIds} />
</div>

<div class="section-row">
	<div class="tableProcess-label"><span>Wide value columns</span></div>
	<div class="control-input-vertical">
		<p class="hint">Ctrl/Cmd-click or Shift-click to select multiple columns</p>
		<ColumnSelector
			multiple={true}
			bind:value={selectedValueColIds}
			excludeColIds={[...outputIds, ...(p.args.timeIN >= 0 ? [Number(p.args.timeIN)] : [])]}
			onChange={() => onValueSelectionChange(selectedValueColIds)}
		/>
	</div>
</div>

{#if errorMessage}
	<p class="input-error">{errorMessage}</p>
{/if}

{#if p.args.valid && Number(p.args.out.time) === -1}
	{@const previewEnd = Math.min(previewStart + 5, previewTotalRows)}
	<p>Preview:</p>
	<Table
		headers={['Time', 'Category', 'Value']}
		data={[
			previewTime.slice(previewStart - 1, previewEnd),
			(wideToLongResult?.category ?? []).slice(previewStart - 1, previewEnd),
			(wideToLongResult?.value ?? []).slice(previewStart - 1, previewEnd)
		]}
	/>
	<p>
		Row <NumberWithUnits
			min={1}
			max={Math.max(1, previewTotalRows - 5)}
			step={1}
			bind:value={previewStart}
		/>
		to {previewEnd} of {previewTotalRows}
	</p>
{:else if p.args.valid && Number(p.args.out.time) >= 0}
	<details open>
		<summary class="section-details-summary">Output</summary>
		<ColumnComponent col={getColumnById(p.args.out.time)} />
		<ColumnComponent col={getColumnById(p.args.out.category)} />
		<ColumnComponent col={getColumnById(p.args.out.value)} />
	</details>
{:else}
	<p>Select one time column and at least one wide value column to begin.</p>
{/if}

<style>
	.hint {
		margin: 0;
		font-size: 0.9rem;
	}

	.input-error {
		color: var(--red, #b42318);
	}
</style>
