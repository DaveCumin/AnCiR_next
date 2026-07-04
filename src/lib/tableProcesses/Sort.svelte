<script module>
	import { normalizeYInputs, migrateLegacyYIN } from '$lib/tableProcesses/tpArgHelpers.js';
	import { core } from '$lib/core/core.svelte';
	import { sortPermutation, applyPermutation } from '$lib/utils/sortRows.js';

	const displayName = 'Sort';

	// One multi-column input (`yIN`, labelled "Columns"). One of those inputs is the
	// sort key, chosen via `sortOnId` (the "Sort on" picker). All inputs are
	// reordered together by the key, so rows stay aligned. Each input gets a
	// "<col> sorted" output ('sortedy_<id>'). There is no separate key input/output.
	const defaults = new Map([
		['yIN', { val: [] }],
		['sortOnId', { val: -1 }], // which yIN column to sort by (-1 = first input)
		['direction', { val: 'asc' }], // 'asc' | 'desc'
		['out', {}],
		['valid', { val: false }],
		['forcollected', { val: true }],
		['collectedType', { val: 'sort' }],
		['preProcesses', { val: [] }],
		['tableProcesses', { val: [] }]
	]);

	export const definition = {
		displayName,
		defaults,
		func: sortdata,
		columnIdFields: { array: ['yIN'] },
		yOutKeyPrefix: 'sortedy_',
		nodeSpec: {
			id: 'tableprocess.sort',
			inputs: [{ name: 'yIN', kind: 'column', cardinality: 'many' }],
			outputs: [
				{ name: 'sortedy_*', kind: 'column', cardinality: 'many', dynamicPrefix: 'sortedy_' }
			]
		}
	};

	/** Resolve the key column id: the chosen sortOnId if it's among the inputs,
	 * otherwise the first input. */
	function resolveSortOn(sortOnId, yINs) {
		if (sortOnId != null && sortOnId !== -1 && yINs.includes(sortOnId)) return sortOnId;
		return yINs.length > 0 ? yINs[0] : -1;
	}

	/**
	 * Reorder every input column together by the chosen key column's order.
	 * Non-destructive; reactive (recomputes when an input or the format changes).
	 *
	 * @param {any} argsIN
	 * @returns {[{order:number[], y_results:Record<string, any[]>}, boolean]}
	 */
	export function sortdata(argsIN) {
		const yINs = normalizeYInputs(argsIN.yIN).filter((id) => id != null && id !== -1);
		const direction = argsIN.direction === 'desc' ? 'desc' : 'asc';

		const empty = () => ({ order: [], y_results: {} });
		if (yINs.length === 0) return [empty(), false];

		const sortOnId = resolveSortOn(argsIN.sortOnId, yINs);
		/** @type {any} */
		const keyCol = getColumnById(sortOnId);
		if (!keyCol) return [empty(), false];

		const keyData = keyCol.getData();
		const n = keyData.length;
		if (n === 0) return [empty(), false];

		const order = sortPermutation(keyData, { direction });
		const processHash = crypto.randomUUID();

		/** @type {{order:number[], y_results:Record<string, any[]>}} */
		const result = { order, y_results: {} };
		let anyWritten = false;

		for (const yId of yINs) {
			/** @type {any} */
			const yCol = getColumnById(yId);
			if (!yCol) continue;
			const yOUT = argsIN.out?.['sortedy_' + yId];
			if (yOUT == null || yOUT === -1) continue;
			const yData = yCol.getData();
			// Only reorder columns row-aligned with the key; others pass through.
			const reordered = yData.length === n ? applyPermutation(yData, order) : yData;
			core.rawData.set(yOUT, reordered);
			/** @type {any} */
			const yOutCol = getColumnById(yOUT);
			yOutCol.data = yOUT;
			yOutCol.type = yCol.type;
			if (yCol.type === 'time') {
				yOutCol.timeFormat = null;
				yOutCol.originTime_ms = yCol.originTime_ms ?? null;
			}
			yOutCol.tableProcessGUId = processHash;
			result.y_results[yId] = reordered;
			anyWritten = true;
		}

		return [result, anyWritten];
	}
</script>

<script>
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';
	import ControlInput from '$lib/components/inputs/ControlInput.svelte';
	import ColumnComponent from '$lib/core/Column.svelte';
	import { Column, getColumnById, removeColumn } from '$lib/core/Column.svelte';
	import { pushObj } from '$lib/core/core.svelte.js';
	import { onMount, untrack } from 'svelte';

	let { p = $bindable(), hideInputs = false } = $props();

	migrateLegacyYIN(p.args);
	if (p.args.direction == null) p.args.direction = 'asc';
	if (p.args.sortOnId == null) p.args.sortOnId = -1;
	if (!p.args.out) p.args.out = {};

	let sortResult = $state();
	let mounted = $state(false);

	// --- Output-column management, named "<src> sorted". ---
	let prevYIds = [...(p.args.yIN ?? [])].map(Number);

	function isCommitted() {
		return p?.id != null && (core.tableProcesses ?? []).some((tp) => tp.id === p.id);
	}

	function makeYColumn(yId) {
		const srcName = getColumnById(Number(yId))?.name ?? String(yId);
		const yCol = new Column({});
		yCol.name = srcName + ' sorted';
		pushObj(yCol);
		if (p.parent && Array.isArray(p.parent.columnRefs)) {
			p.parent.columnRefs = [yCol.id, ...p.parent.columnRefs];
		}
		return yCol.id;
	}

	function syncYColumns() {
		const newIds = (p.args.yIN ?? []).map(Number).filter((id) => id >= 0);
		const newSet = new Set(newIds);
		if (newIds.length === prevYIds.length && newIds.every((id) => prevYIds.includes(id))) return false;
		if (isCommitted()) {
			for (const oldId of prevYIds) {
				if (!newSet.has(oldId)) {
					const outKey = 'sortedy_' + oldId;
					const outColId = p.args.out[outKey];
					if (outColId != null && outColId >= 0) {
						core.rawData.delete(outColId);
						removeColumn(outColId);
					}
					delete p.args.out[outKey];
				}
			}
			for (const newId of newIds) {
				const outKey = 'sortedy_' + newId;
				if (p.args.out[outKey] == null || p.args.out[outKey] === -1) {
					p.args.out[outKey] = makeYColumn(newId);
				}
			}
		}
		prevYIds = [...newIds];
		return true;
	}

	function initYColumns() {
		if (!isCommitted()) {
			prevYIds = [...(p.args.yIN ?? [])].map(Number);
			return false;
		}
		let needsCompute = false;
		for (const yId of p.args.yIN ?? []) {
			const outKey = 'sortedy_' + yId;
			if (p.args.out[outKey] == null || p.args.out[outKey] === -1) {
				p.args.out[outKey] = makeYColumn(yId);
				needsCompute = true;
			}
		}
		prevYIds = [...(p.args.yIN ?? [])].map(Number);
		return needsCompute;
	}

	// The columns available to be the sort key = the selected inputs.
	let keyOptions = $derived(
		(p.args.yIN ?? [])
			.map(Number)
			.filter((id) => id >= 0)
			.map((id) => ({ id, name: getColumnById(id)?.name ?? String(id) }))
	);

	// Keep sortOnId valid: default to the first input when unset/removed.
	$effect(() => {
		const ids = keyOptions.map((o) => o.id);
		if (mounted && ids.length > 0 && !ids.includes(p.args.sortOnId)) {
			untrack(() => (p.args.sortOnId = ids[0]));
		}
	});

	let getHash = $derived.by(() => {
		let h = '';
		for (const yId of p.args.yIN ?? []) {
			const col = yId >= 0 ? getColumnById(yId) : null;
			h += '|' + (col?.getDataHash ?? '');
		}
		h += '|on:' + p.args.sortOnId + '|dir:' + p.args.direction;
		return h;
	});
	let lastHash = '';

	$effect(() => {
		const dataHash = getHash;
		if (!mounted) return;
		if (dataHash !== lastHash) {
			untrack(() => {
				[sortResult, p.args.valid] = sortdata(p.args);
			});
			lastHash = dataHash;
		}
	});

	function recompute() {
		[sortResult, p.args.valid] = sortdata(p.args);
		lastHash = getHash;
	}

	function onYSelectionChange() {
		if (syncYColumns()) recompute();
	}

	let ownOutputIds = $derived.by(() => {
		const ids = [];
		for (const key of Object.keys(p.args.out)) {
			if (p.args.out[key] >= 0) ids.push(p.args.out[key]);
		}
		return ids;
	});

	$effect(() => {
		p.args.yIN; // track
		if (!mounted) return;
		untrack(() => onYSelectionChange());
	});

	onMount(() => {
		if (!p.args.out) p.args.out = {};
		const needsCompute = initYColumns();
		if (p.args.sortOnId === -1 && (p.args.yIN ?? []).length > 0) {
			p.args.sortOnId = Number(p.args.yIN[0]);
		}
		if (needsCompute) {
			recompute();
		} else {
			const anyOut = Object.values(p.args.out).some((v) => typeof v === 'number' && v >= 0);
			if (anyOut) {
				const inputsAreStale = (p.args.yIN ?? []).some(
					(id) => (getColumnById(id)?.rawDataVersion ?? 0) > 0
				);
				if (!inputsAreStale) {
					const y_results = {};
					for (const yId of p.args.yIN ?? []) {
						const yOutId = p.args.out['sortedy_' + yId];
						if (yOutId >= 0 && core.rawData.has(yOutId)) y_results[yId] = core.rawData.get(yOutId);
					}
					sortResult = { y_results };
					p.args.valid = true;
				}
			}
		}
		mounted = true;
	});
</script>

{#if !hideInputs}
	<div class="section-row">
		<div class="tableProcess-label"><span>Input</span></div>
		<div class="control-input-vertical">
			<div class="control-input">
				<p>Columns</p>
				<ColumnSelector
					bind:value={p.args.yIN}
					excludeColIds={ownOutputIds}
					multiple={true}
					onChange={onYSelectionChange}
				/>
			</div>
		</div>
	</div>
{/if}

<div class="section-row">
	<div class="tableProcess-label"><span>Order</span></div>
	<ControlInput label="Sort on">
		<select bind:value={p.args.sortOnId} onchange={recompute} disabled={keyOptions.length === 0}>
			{#if keyOptions.length === 0}
				<option value={-1}>— add columns first —</option>
			{/if}
			{#each keyOptions as opt}
				<option value={opt.id}>{opt.name}</option>
			{/each}
		</select>
	</ControlInput>
	<ControlInput label="Direction">
		<select bind:value={p.args.direction} onchange={recompute}>
			<option value="asc">Ascending</option>
			<option value="desc">Descending</option>
		</select>
	</ControlInput>
</div>

<details open>
	<summary class="section-details-summary">Output</summary>
	<div class="section-row">
		<div class="section-content">
			{#key sortResult}
				{#if p.args.valid}
					<div class="tableProcess-label"><span>Output</span></div>
					<div class="tp-outputs">
						{#each p.args.yIN ?? [] as yId}
							{@const yOutId = p.args.out['sortedy_' + yId]}
							{#if yOutId >= 0}
								{@const yout = getColumnById(yOutId)}
								{#if yout}
									<div class="tp-output-row">
										<span class="tp-output-label">{getColumnById(Number(yId))?.name ?? yId} sorted</span>
										<ColumnComponent col={yout} />
									</div>
								{/if}
							{/if}
						{/each}
					</div>
				{:else}
					<p>Select one or more columns and a column to sort on.</p>
				{/if}
			{/key}
		</div>
	</div>
</details>
