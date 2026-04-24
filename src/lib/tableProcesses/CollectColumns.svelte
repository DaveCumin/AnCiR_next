<script module>
	// @ts-nocheck
	import { core, appConsts } from '$lib/core/core.svelte';
	import { getColumnById } from '$lib/core/Column.svelte';
	import { min as arrMin, max as arrMax } from '$lib/utils/stats.js';

	const displayName = 'Collect Columns';
	const defaults = new Map([
		['colIds', { val: [] }],
		['out', {}],
		['outColIds', { val: [] }],
		['tableProcesses', { val: [] }],
		['preProcesses', { val: [] }],
		['valid', { val: false }]
	]);

	export function collectcolumns(argsIN) {
		const colIds = argsIN.colIds ?? [];
		if (colIds.length === 0) return [{}, false];

		// Read data for each input column
		const result = {};
		for (const colId of colIds) {
			const col = getColumnById(colId);
			if (!col) return [{}, false];
			result[colId] = [...col.getData()];
		}

		// Apply pre-processes to all columns
		for (const pp of argsIN.preProcesses ?? []) {
			if (!pp.processName) continue;
			const proc = appConsts.processMap.get(pp.processName);
			if (proc?.func) {
				for (const colId of colIds) {
					result[colId] = proc.func(result[colId], pp.processArgs ?? {});
				}
			}
		}

		// Write to output columns
		const hasOut = Object.values(argsIN.out ?? {}).some((v) => Number(v) >= 0);
		if (hasOut) {
			const processHash = crypto.randomUUID();
			for (const colId of colIds) {
				const outColId = argsIN.out['col_' + colId];
				if (outColId !== undefined && Number(outColId) >= 0) {
					core.rawData.set(outColId, result[colId]);
					const outCol = getColumnById(outColId);
					const inCol = getColumnById(colId);
					outCol.data = outColId;
					outCol.type = inCol?.type ?? 'number';
					// For time columns: the collected data is already parsed UNIX ms,
					// so clear timeFormat to prevent getData() from re-parsing.
					if (outCol.type === 'time') {
						outCol.timeFormat = null;
					}
					outCol.tableProcessGUId = processHash;
				}
			}
		}

		// Compute row-wise aggregates
		for (const agg of argsIN.aggregates ?? []) {
			const { method, excludedColIds = [], outColId } = agg;
			if (outColId === undefined || Number(outColId) < 0) continue;

			const includedColIds = colIds.filter((id) => !excludedColIds.includes(id));
			if (includedColIds.length === 0) continue;

			const nRows = result[includedColIds[0]]?.length ?? 0;
			const aggData = [];

			for (let i = 0; i < nRows; i++) {
				const rowVals = includedColIds
					.map((id) => result[id][i])
					.filter((v) => v != null && !isNaN(v));
				let aggVal;
				if (method === 'mean') {
					aggVal = rowVals.reduce((a, b) => a + b, 0) / rowVals.length;
				} else if (method === 'min') {
					aggVal = arrMin(rowVals);
				} else if (method === 'max') {
					aggVal = arrMax(rowVals);
				} else if (method === 'sum') {
					aggVal = rowVals.reduce((a, b) => a + b, 0);
				}
				aggData.push(aggVal);
			}

			core.rawData.set(outColId, aggData);
			const aggCol = getColumnById(outColId);
			if (aggCol) {
				aggCol.data = outColId;
				aggCol.type = 'number';
				aggCol.tableProcessGUId = crypto.randomUUID();
			}
		}

		return [result, colIds.length > 0];
	}

	export const definition = {
		displayName,
		defaults,
		func: collectcolumns,
		columnIdFields: { array: ['colIds', 'outColIds'] }
	};
</script>

<script>
	// @ts-nocheck
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';
	import ColumnComponent from '$lib/core/Column.svelte';
	import ChainedPanel from '$lib/components/reusables/ChainedPanel.svelte';
	import { Column, removeColumn } from '$lib/core/Column.svelte';
	import { pushObj } from '$lib/core/core.svelte.js';
	import { Process } from '$lib/core/Process.svelte';
	import Processcomponent from '$lib/core/Process.svelte';
	import { onMount, untrack } from 'svelte';

	let { p = $bindable() } = $props();

	let collectResult = $state();
	let mounted = $state(false);
	let preProcessProcs = $state([]);

	let sortedProcesses = $derived.by(() => {
		return Array.from(appConsts.processMap.entries()).sort((a, b) => {
			const nameA = a[1].displayName || a[0];
			const nameB = b[1].displayName || b[0];
			return nameA.localeCompare(nameB);
		});
	});

	let selectedColIds = $state(p.args.colIds ?? []);

	// Exclude tp output IDs from the input column selector
	let tpExcludeIds = $derived.by(() => {
		const ids = [];
		for (const tp of p.args.tableProcesses ?? []) {
			for (const colId of Object.values(tp.args?.out ?? {})) {
				if (colId >= 0) ids.push(colId);
			}
		}
		return ids;
	});

	let getHash = $derived.by(() => {
		let h = '';
		for (const colId of p.args.colIds ?? []) {
			h += getColumnById(colId)?.getDataHash ?? '';
			const outColId = p.args.out?.['col_' + colId];
			if (outColId >= 0) {
				const col = getColumnById(outColId);
				if (col) {
					h += col.processes
						.map((proc) => `${proc.id}:${proc.name}:${JSON.stringify(proc.args)}`)
						.join('|');
				}
			}
		}
		h += preProcessProcs
			.map((proc) => `${proc?.name ?? ''}:${JSON.stringify(proc?.args ?? {})}`)
			.join('|');
		h += (p.args.tableProcesses ?? [])
			.map((tp) => tp.type + JSON.stringify(tp.args) + (tp.excludedColIds ?? []).join(','))
			.join('|');
		return h;
	});

	let lastHash = '';

	// Sync preProcessProcs args back to p.args for session persistence
	$effect(() => {
		const snapshots = preProcessProcs.map((proc) => JSON.stringify(proc?.args ?? {}));
		untrack(() => {
			for (let i = 0; i < snapshots.length; i++) {
				if (p.args.preProcesses[i]) {
					p.args.preProcesses[i].processArgs = JSON.parse(snapshots[i]);
				}
			}
		});
	});

	$effect(() => {
		const dataHash = getHash;
		if (!mounted) return;
		if (dataHash !== lastHash) {
			untrack(() => {
				doCollect();
			});
			lastHash = dataHash;
		}
	});

	$effect(() => {
		const newIds = selectedColIds;
		if (!mounted) return;
		untrack(() => {
			onSelectionChange(newIds);
		});
	});

	function onSelectionChange(newIds) {
		const newIdSet = new Set(newIds.map(Number));
		const oldIds = p.args.colIds ?? [];
		if (
			newIds.length === oldIds.length &&
			[...newIdSet].every((id) => oldIds.map(Number).includes(id))
		)
			return;
		for (const oldId of oldIds) {
			if (!newIdSet.has(Number(oldId))) {
				const outKey = 'col_' + oldId;
				const outColId = p.args.out[outKey];
				if (outColId !== undefined && outColId >= 0) {
					core.rawData.delete(outColId);
					removeColumn(outColId);
				}
				delete p.args.out[outKey];
			}
		}
		p.args.colIds = [...newIds].map(Number);
		doCollect();
	}

	function addPreProcess() {
		p.args.preProcesses = [...p.args.preProcesses, { processName: '', processArgs: {} }];
		preProcessProcs = [...preProcessProcs, null];
	}

	// Minimal stand-in for a Column so process components that
	// access p.parentCol.id / .type / .removeProcess() don't crash.
	const _dummyParentCol = { id: -1, type: 'number', removeProcess() {} };

	function setPreProcess(idx, processName) {
		if (!processName) {
			p.args.preProcesses[idx] = { processName: '', processArgs: {} };
			preProcessProcs[idx] = null;
		} else {
			const proc = new Process({ name: processName }, _dummyParentCol);
			p.args.preProcesses[idx] = { processName, processArgs: proc.args };
			preProcessProcs[idx] = proc;
		}
		p.args.preProcesses = [...p.args.preProcesses];
		preProcessProcs = [...preProcessProcs];
		doCollect();
	}

	function removePreProcess(idx) {
		p.args.preProcesses = p.args.preProcesses.filter((_, i) => i !== idx);
		preProcessProcs = preProcessProcs.filter((_, i) => i !== idx);
		doCollect();
	}

	// ─── Table process constants ───────────────────────────────────────────────

	// Keys in TP defaults that are infrastructure, not user-facing parameters
	const _TP_INFRA_KEYS = new Set([
		'xIN',
		'yIN',
		'out',
		'valid',
		'forcollected',
		'collectedType',
		'outputX'
	]);

	// Overrides applied on top of TP defaults when used in collected mode
	const _COLLECTED_OVERRIDES = {
		cosinor: { useFixedPeriod: true, Ncurves: 1 },
		bin: { binSize: 1, stepSize: 1 }
	};

	/** Build a map from collectedType → { component, paramDefaults } from the global tableProcessMap */
	let collectedTPMap = $derived.by(() => {
		const map = {};
		for (const [, entry] of appConsts.tableProcessMap) {
			const defs = entry.defaults;
			if (!defs?.get?.('forcollected')?.val) continue;
			const cType = defs.get('collectedType')?.val;
			if (!cType) continue;
			// Extract parameter-only defaults
			const params = {};
			for (const [key, def] of defs) {
				if (_TP_INFRA_KEYS.has(key)) continue;
				params[key] = def.val ?? def;
			}
			// Apply collected-mode overrides
			const overrides = _COLLECTED_OVERRIDES[cType] ?? {};
			map[cType] = {
				component: entry.component,
				displayName: entry.displayName,
				paramDefaults: { ...params, ...overrides },
				xOutKey: entry.xOutKey ?? null,
				yOutKeyPrefix: entry.yOutKeyPrefix ?? null
			};
		}
		return map;
	});

	function addTableProcess(type) {
		if (!type || !collectedTPMap[type]) return;
		const activeOutColIds = [...(p.args.outColIds ?? [])];
		const tp = {
			id: crypto.randomUUID(),
			type,
			xColId: -1,
			excludedColIds: [],
			args: {
				...collectedTPMap[type].paramDefaults,
				xIN: -1,
				yIN: activeOutColIds,
				out: {},
				valid: false
			}
		};
		p.args.tableProcesses = [...p.args.tableProcesses, tp];
	}

	function removeTableProcess(idx) {
		const tp = p.args.tableProcesses[idx];
		// Remove all output columns stored in tp.args.out
		for (const colId of Object.values(tp.args?.out ?? {})) {
			if (colId != null && colId >= 0) {
				core.rawData.delete(colId);
				removeColumn(colId);
			}
		}
		p.args.tableProcesses = p.args.tableProcesses.filter((_, i) => i !== idx);
	}

	function toggleExcludeForTp(tpIdx, colId) {
		const tp = p.args.tableProcesses[tpIdx];
		const excluded = tp.excludedColIds ?? [];
		const newExcluded = excluded.includes(colId)
			? excluded.filter((id) => id !== colId)
			: [...excluded, colId];
		tp.excludedColIds = newExcluded;
		const outColIds = p.args.outColIds ?? p.args.colIds ?? [];
		tp.args.yIN = outColIds.filter((id) => !newExcluded.includes(id));
		p.args.tableProcesses = [...p.args.tableProcesses];
	}

	function doCollect() {
		if (p.parent && (p.args.colIds?.length ?? 0) > 0) {
			for (const colId of p.args.colIds) {
				const outKey = 'col_' + colId;
				if (p.args.out[outKey] === undefined || p.args.out[outKey] === -1) {
					const inCol = getColumnById(colId);
					const tempCol = new Column({});
					tempCol.name = (inCol?.name ?? 'col') + '_' + p.id;
					p.args.out[outKey] = tempCol.id;
					pushObj(tempCol);
					p.parent.columnRefs = [tempCol.id, ...p.parent.columnRefs];
				}
			}
			p.args.outColIds = p.args.colIds
				.map((colId) => p.args.out['col_' + colId])
				.filter((id) => id !== undefined && id >= 0);
		}

		[collectResult, p.args.valid] = collectcolumns(p.args);

		// Update xIN / yIN for each table process after collect
		const newOutColIds = [...(p.args.outColIds ?? [])];
		for (const tp of p.args.tableProcesses ?? []) {
			tp.args.xIN = tp.xColId >= 0 ? tp.xColId : -1;
			const excluded = tp.excludedColIds ?? [];
			tp.args.yIN = newOutColIds.filter((id) => !excluded.includes(id));
		}
		if ((p.args.tableProcesses ?? []).length > 0) {
			p.args.tableProcesses = [...p.args.tableProcesses];
		}
	}

	onMount(() => {
		if (!p.args.preProcesses) p.args.preProcesses = [];
		if (!p.args.tableProcesses) p.args.tableProcesses = [];
		if (!p.args.colIds) p.args.colIds = [];
		if (!p.args.out) p.args.out = {};
		if (!p.args.outColIds) p.args.outColIds = [];

		// Migrate old tp structures to new format: { args: { ..., xIN, yIN, out, valid } }
		const _TP_X_KEY = {
			cosinor: 'cosinorx',
			bin: 'binnedx',
			smooth: 'smoothedx',
			trend: 'trendx',
			rectwave: 'rectwavex',
			dlog: 'dlogx'
		};
		const _TP_Y_PREFIX = {
			cosinor: 'cosinory_',
			bin: 'binnedy_',
			smooth: 'smoothedy_',
			trend: 'trendy_',
			rectwave: 'rectwavey_',
			dlog: 'dlogy_'
		};
		for (const tp of p.args.tableProcesses) {
			if (!tp.id) tp.id = crypto.randomUUID();
			if (tp.xColId === undefined) tp.xColId = -1;
			if (!tp.args) tp.args = {};
			// Very-old format: out[colId] = { xOutId, yOutId }
			if (tp.xOutId === undefined && typeof Object.values(tp.out ?? {})[0] === 'object') {
				const firstPair = Object.values(tp.out ?? {}).find((v) => v && typeof v === 'object');
				tp.xOutId = firstPair?.xOutId ?? -1;
				const flatOut = {};
				let first = true;
				for (const [colIdStr, pair] of Object.entries(tp.out ?? {})) {
					if (pair && typeof pair === 'object') {
						if (!first && pair.xOutId >= 0) {
							core.rawData.delete(pair.xOutId);
							removeColumn(pair.xOutId);
						}
						flatOut[colIdStr] = pair.yOutId ?? -1;
						first = false;
					} else {
						flatOut[colIdStr] = pair;
					}
				}
				tp.out = flatOut;
			}
			// Mid-old format: xOutId at tp level, out[colId] = yId
			if ('xOutId' in tp) {
				const xKey = _TP_X_KEY[tp.type] ?? 'x_out';
				const yPrefix = _TP_Y_PREFIX[tp.type] ?? 'y_out_';
				const migrOut = {};
				migrOut[xKey] = tp.xOutId ?? -1;
				for (const [colId, yId] of Object.entries(tp.out ?? {})) {
					migrOut[yPrefix + colId] = yId;
				}
				tp.args.out = migrOut;
				tp.args.yIN = [];
				tp.args.xIN = tp.xColId >= 0 ? tp.xColId : -1;
				tp.args.valid = false;
				delete tp.xOutId;
				delete tp.out;
			}
			// Ensure required fields exist
			if (!tp.args.out) tp.args.out = {};
			if (!tp.args.yIN) tp.args.yIN = [];
			if (tp.args.xIN === undefined) tp.args.xIN = tp.xColId >= 0 ? tp.xColId : -1;
			if (tp.args.valid === undefined) tp.args.valid = false;
		}

		const firstOutId = Object.values(p.args.out ?? {}).find((v) => typeof v === 'number' && v >= 0);
		if (
			firstOutId !== undefined &&
			core.rawData.has(firstOutId) &&
			core.rawData.get(firstOutId).length > 0
		) {
			// Check if any input columns have been replaced since session was saved
			const inputsAreStale = (p.args.colIds ?? []).some(
				(id) => (getColumnById(id)?.rawDataVersion ?? 0) > 0
			);
			collectResult = {};
			for (const colId of p.args.colIds) {
				const outColId = p.args.out['col_' + colId];
				if (outColId >= 0 && core.rawData.has(outColId)) {
					collectResult[colId] = core.rawData.get(outColId);
				}
			}
			p.args.valid = true;
			if (!p.args.outColIds?.length) {
				p.args.outColIds = p.args.colIds
					.map((colId) => p.args.out['col_' + colId])
					.filter((id) => id !== undefined && id >= 0);
			}
			if (!inputsAreStale) lastHash = getHash;
		}

		// Sync xIN/yIN for each table process from current state
		if (p.args.valid) {
			const initOutColIds = [...(p.args.outColIds ?? [])];
			for (const tp of p.args.tableProcesses ?? []) {
				tp.args.xIN = tp.xColId >= 0 ? tp.xColId : -1;
				const excluded = tp.excludedColIds ?? [];
				tp.args.yIN = initOutColIds.filter((id) => !excluded.includes(id));
			}
			if ((p.args.tableProcesses ?? []).length > 0) {
				p.args.tableProcesses = [...p.args.tableProcesses];
			}
		}

		preProcessProcs = p.args.preProcesses.map((pp) =>
			pp.processName
				? new Process({ name: pp.processName, args: pp.processArgs }, _dummyParentCol)
				: null
		);
		selectedColIds = [...(p.args.colIds ?? [])];
		mounted = true;
	});
</script>

<!-- Input Section -->
<div class="section-row">
	<div class="tableProcess-label"><span>Input columns</span></div>
	<div class="control-input-vertical">
		<p class="hint">Ctrl/Cmd-click or Shift-click to select multiple columns</p>
		<ColumnSelector multiple={true} bind:value={selectedColIds} excludeColIds={tpExcludeIds} />
	</div>
</div>

<!-- Pre-process Section -->
{#if p.args.valid}
	<div class="section-row">
		<div class="tableProcess-label"><span>Pre-process</span></div>
		<div class="control-input-vertical">
			{#each p.args.preProcesses as pp, idx (idx)}
				<div class="tp-block">
					<div class="tp-header">
						<span class="tp-title">Step {idx + 1}</span>
						<button class="remove-btn" onclick={() => removePreProcess(idx)} title="Remove"
							>×</button
						>
					</div>
					<div class="control-input">
						<p>Process</p>
						<select value={pp.processName} onchange={(e) => setPreProcess(idx, e.target.value)}>
							<option value="">Select…</option>
							{#each sortedProcesses as [key, value] (key)}
								<option value={key}>{value.displayName || key}</option>
							{/each}
						</select>
					</div>
					{#if preProcessProcs[idx]}
						<Processcomponent p={preProcessProcs[idx]} />
					{/if}
				</div>
			{/each}
			<button class="add-tp-btn" onclick={addPreProcess}>+ Add pre-process step</button>
		</div>
	</div>
{/if}

<!-- Output / Preview -->
<details open>
	<summary class="section-details-summary">Output</summary>
	<div class="section-row">
		<div class="section-content">
			{#key collectResult}
				{#if p.args.valid && (p.args.outColIds?.length ?? 0) > 0}
					<div class="tableProcess-label"><span>Output</span></div>
					{#each p.args.colIds as colId (colId)}
						{@const outColId = p.args.out['col_' + colId]}
						{#if outColId >= 0}
							<ColumnComponent col={getColumnById(outColId)} />
						{/if}
					{/each}
				{:else if p.args.valid && collectResult}
					<p>Select a table to commit outputs.</p>
				{:else}
					<p>Select columns above to begin.</p>
				{/if}
			{/key}
		</div>
	</div>
</details>

<!-- Table Processes Section -->
{#if p.args.valid}
	<div class="section-row">
		<div class="tableProcess-label"><span>Table processes</span></div>
		<div class="control-input-vertical">
			{#each p.args.tableProcesses as tp, tpIdx (tpIdx)}
				<div class="tp-block">
					<div class="tp-header">
						<span class="tp-title">{collectedTPMap[tp.type]?.displayName ?? tp.type}</span>
						<button class="remove-btn" onclick={() => removeTableProcess(tpIdx)} title="Remove"
							>×</button
						>
					</div>

					<!-- X-axis column selector -->
					<div class="control-input">
						<p>X column</p>
						<ColumnSelector
							bind:value={tp.xColId}
							allowNone={true}
							onChange={() => {
								tp.args.xIN = tp.xColId >= 0 ? tp.xColId : -1;
								p.args.tableProcesses = [...p.args.tableProcesses];
							}}
						/>
					</div>

					<!-- Type-specific parameters (rendered by the TP component) -->
					{#if collectedTPMap[tp.type]?.component}
						{@const DynamicTP = collectedTPMap[tp.type].component}
						<DynamicTP p={{ id: tp.id, args: tp.args, parent: p.parent }} hideInputs={true} />
					{/if}

					<!-- ChainedPanel for chainable sub-TPs -->
					{#if collectedTPMap[tp.type]?.xOutKey && tp.args?.valid}
						{@const _tpEntry = collectedTPMap[tp.type]}
						{@const _subXOut = tp.args?.out?.[_tpEntry.xOutKey] ?? -1}
						{@const _subYOuts = Object.entries(tp.args?.out ?? {})
							.filter(([k]) => k.startsWith(_tpEntry.yOutKeyPrefix))
							.map(([, id]) => id)
							.filter((id) => typeof id === 'number' && id >= 0)}
						<ChainedPanel
							bind:p={p.args.tableProcesses[tpIdx]}
							xOutColId={_subXOut}
							yOutColIds={_subYOuts}
							parentRef={p.parent}
						/>
					{/if}

					<!-- Column checklist (include/exclude) -->
					{#if (p.args.outColIds?.length ?? 0) > 0 || (p.args.colIds?.length ?? 0) > 0}
						{@const checkColIds =
							(p.args.outColIds?.length ?? 0) > 0 ? p.args.outColIds : (p.args.colIds ?? [])}
						{@const excluded = tp.excludedColIds ?? []}
						{@const nActive = checkColIds.length - excluded.length}
						<div class="control-input-vertical">
							<p>Columns ({nActive} of {checkColIds.length} included)</p>
							<div class="col-checklist">
								{#each checkColIds as colId (colId)}
									{@const col = getColumnById(colId)}
									{@const included = !excluded.includes(colId)}
									<label class="col-check-item">
										<input
											type="checkbox"
											checked={included}
											onchange={() => toggleExcludeForTp(tpIdx, colId)}
										/>
										{col?.name ?? `col ${colId}`}
									</label>
								{/each}
							</div>
						</div>
					{/if}
				</div>
			{/each}

			<select
				class="add-tp-select"
				onchange={(e) => {
					addTableProcess(e.target.value);
					e.target.value = '';
				}}
			>
				<option value="">+ Add table process…</option>
				{#each Object.entries(collectedTPMap) as [cType, entry] (cType)}
					<option value={cType}>{entry.displayName}</option>
				{/each}
			</select>
		</div>
	</div>
{/if}

<style>
	.hint {
		font-size: 11px;
		color: var(--color-lightness-55, #888);
		margin: 0 0 0.25rem 0;
	}

	.tp-block {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		border: 1px solid var(--color-lightness-85);
		border-radius: 4px;
		padding: 0.5rem 0.6rem;
		width: 100%;
	}

	.tp-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.tp-title {
		font-size: 12px;
		font-weight: 600;
	}

	.remove-btn {
		background: none;
		border: none;
		cursor: pointer;
		font-size: 16px;
		line-height: 1;
		color: var(--color-lightness-55, #888);
		padding: 0 0.2rem;
	}

	.remove-btn:hover {
		color: #c0392b;
	}

	.add-tp-btn {
		background: none;
		border: 1px dashed var(--color-lightness-75, #aaa);
		border-radius: 4px;
		cursor: pointer;
		font-size: 12px;
		padding: 0.3rem 0.6rem;
		color: var(--color-lightness-45, #666);
		width: 100%;
		text-align: center;
	}

	.add-tp-btn:hover {
		border-color: var(--color-lightness-55, #888);
		color: var(--color-lightness-25, #333);
	}

	.add-tp-select {
		font-size: 12px;
		padding: 0.3rem 0.4rem;
		border: 1px dashed var(--color-lightness-75, #aaa);
		border-radius: 4px;
		background: none;
		cursor: pointer;
		color: var(--color-lightness-45, #666);
		width: 100%;
	}

	.col-checklist {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		max-height: 150px;
		overflow-y: auto;
		border: 1px solid var(--color-lightness-85);
		border-radius: 4px;
		padding: 0.25rem 0.4rem;
	}

	.col-check-item {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 12px;
		cursor: pointer;
		padding: 0.1rem 0;
	}
</style>
