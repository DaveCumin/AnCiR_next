<script module>
	// @ts-nocheck
	import { core, appConsts } from '$lib/core/core.svelte';
	import { getColumnById } from '$lib/core/Column.svelte';

	export const collectcolumns_displayName = 'Collect Columns';
	export const collectcolumns_defaults = new Map([
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
					getColumnById(outColId).data = outColId;
					getColumnById(outColId).type = getColumnById(colId)?.type ?? 'number';
					getColumnById(outColId).tableProcessGUId = processHash;
				}
			}
		}

		return [result, colIds.length > 0];
	}
</script>

<script>
	// @ts-nocheck
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';
	import ColumnComponent from '$lib/core/Column.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import { Column, removeColumn } from '$lib/core/Column.svelte';
	import { pushObj } from '$lib/core/core.svelte.js';
	import { Process } from '$lib/core/Process.svelte';
	import Processcomponent from '$lib/core/Process.svelte';
	import { onMount, untrack } from 'svelte';

	// Algorithm imports for per-column table processes
	import { fitCosineCurves, fitCosinorFixed } from '$lib/utils/cosinor.js';
	import { binData } from '$lib/components/plotbits/helpers/wrangleData.js';
	import { smoothArrays } from '$lib/utils/smoothing.js';
	import { fitTrend } from '$lib/utils/trendfit.js';
	import { fitRectangularWave, evaluateRectWaveAtPoints } from '$lib/utils/rectwave.js';
	import { fitDoubleLogistic, evaluateDoubleLogisticAtPoints } from '$lib/utils/doublelogistic.js';

	let { p = $bindable() } = $props();

	let collectResult = $state();
	let mounted = $state(false);
	let preProcessProcs = $state([]);
	// tableProcessResults[tpIdx] = array of { colId, valid, stats }
	let tableProcessResults = $state([]);

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
			if (tp.xOutId >= 0) ids.push(tp.xOutId);
			for (const yOutId of Object.values(tp.out ?? {})) {
				if (yOutId >= 0) ids.push(yOutId);
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
			untrack(() => { doCollect(); });
			lastHash = dataHash;
		}
	});

	$effect(() => {
		const newIds = selectedColIds;
		if (!mounted) return;
		untrack(() => { onSelectionChange(newIds); });
	});

	function onSelectionChange(newIds) {
		const newIdSet = new Set(newIds.map(Number));
		const oldIds = p.args.colIds ?? [];
		if (newIds.length === oldIds.length && [...newIdSet].every((id) => oldIds.map(Number).includes(id))) return;
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

	function setPreProcess(idx, processName) {
		if (!processName) {
			p.args.preProcesses[idx] = { processName: '', processArgs: {} };
			preProcessProcs[idx] = null;
		} else {
			const proc = new Process({ name: processName }, null);
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

	const TP_DEFAULTS = {
		cosinor:  { useFixedPeriod: true, fixedPeriod: 24, nHarmonics: 1, alpha: 0.05, Ncurves: 1 },
		bin:      { binSize: 1, binStart: 0, stepSize: 1, diffStep: false, aggFunction: 'mean' },
		smooth:   { smootherType: 'moving', whittakerLambda: 100, whittakerOrder: 2, savitzkyWindowSize: 5, savitzkyPolyOrder: 2, loessBandwidth: 0.3, movingAvgWindowSize: 5, movingAvgType: 'simple' },
		trend:    { model: 'linear', polyDegree: 2 },
		rectwave: { fixKappa: false, fixedKappa: 5, fixOmega: false, fixedPeriod: 24, fixDutyCycle: false, fixedDutyCycle: 0.5 },
		dlog:     { fixK1: false, fixedK1: 0.5, fixK2: false, fixedK2: 0.5, fixPeriod: false, fixedPeriod: 24 }
	};

	const TP_LABELS = {
		cosinor:  'Cosinor fit',
		bin:      'Bin data',
		smooth:   'Smooth data',
		trend:    'Trend fit',
		rectwave: 'Rectangular wave fit',
		dlog:     'Double logistic fit'
	};

	// ─── ColumnSelector registration key helpers ─────────────────────────────
	function _tpXKey(tp) { return 'tp_' + tp.id + '_x'; }
	function _tpYKey(tp, colId) { return 'tp_' + tp.id + '_y_' + colId; }

	function addTableProcess(type) {
		if (!type) return;
		const tp = { id: crypto.randomUUID(), type, xColId: -1, excludedColIds: [], args: { ...TP_DEFAULTS[type] }, xOutId: -1, out: {} };
		p.args.tableProcesses = [...p.args.tableProcesses, tp];
		const newIdx = p.args.tableProcesses.length - 1;
		reconcileTableProcessOutputCols(newIdx);
		applyTableProcesses();
	}

	function removeTableProcess(idx) {
		const tp = p.args.tableProcesses[idx];
		if (tp.xOutId >= 0) { core.rawData.delete(tp.xOutId); removeColumn(tp.xOutId); }
		if (tp.id) delete p.args.out[_tpXKey(tp)];
		for (const [colIdStr, yOutId] of Object.entries(tp.out ?? {})) {
			if (yOutId >= 0) { core.rawData.delete(yOutId); removeColumn(yOutId); }
			if (tp.id) delete p.args.out[_tpYKey(tp, colIdStr)];
		}
		p.args.tableProcesses = p.args.tableProcesses.filter((_, i) => i !== idx);
		tableProcessResults = tableProcessResults.filter((_, i) => i !== idx);
	}

	function toggleExcludeForTp(tpIdx, colId) {
		const tp = p.args.tableProcesses[tpIdx];
		const excluded = tp.excludedColIds ?? [];
		const newExcluded = excluded.includes(colId)
			? excluded.filter((id) => id !== colId)
			: [...excluded, colId];
		p.args.tableProcesses[tpIdx] = { ...tp, excludedColIds: newExcluded };
		p.args.tableProcesses = [...p.args.tableProcesses];
		applyTableProcesses();
	}

	function reconcileTableProcessOutputCols(tpIdx) {
		const tp = p.args.tableProcesses[tpIdx];
		if (!tp.id) tp.id = crypto.randomUUID();

		const activeOutColIds = p.args.outColIds ?? [];

		// Ensure shared x output column
		if ((tp.xOutId === undefined || tp.xOutId === -1) && p.parent) {
			const xCol = new Column({});
			xCol.name = `${tp.type}x_${p.id}`;
			pushObj(xCol);
			p.parent.columnRefs = [xCol.id, ...p.parent.columnRefs];
			tp.xOutId = xCol.id;
		} else if (tp.xOutId === undefined) {
			tp.xOutId = -1;
		}
		if (tp.xOutId >= 0) p.args.out[_tpXKey(tp)] = tp.xOutId;

		// Add y column for newly-appeared output columns
		for (const colId of activeOutColIds) {
			const existing = tp.out[colId];
			if (existing === undefined || existing === -1) {
				if (p.parent) {
					const srcName = getColumnById(colId)?.name ?? String(colId);
					const yCol = new Column({});
					yCol.name = srcName + '_biny';
					pushObj(yCol);
					p.parent.columnRefs = [yCol.id, ...p.parent.columnRefs];
					tp.out[colId] = yCol.id;
					p.args.out[_tpYKey(tp, colId)] = yCol.id;
				} else {
					tp.out[colId] = -1;
				}
			} else if (existing >= 0) {
				p.args.out[_tpYKey(tp, colId)] = existing;
			}
		}

		// Remove y columns for output columns that are gone
		for (const [colIdStr, yOutId] of Object.entries(tp.out)) {
			if (!activeOutColIds.includes(Number(colIdStr))) {
				if (yOutId >= 0) { core.rawData.delete(yOutId); removeColumn(yOutId); }
				delete p.args.out[_tpYKey(tp, colIdStr)];
				delete tp.out[colIdStr];
			}
		}

		p.args.tableProcesses = [...p.args.tableProcesses];
	}

	function applyTableProcesses() {
		if (!p.args.valid) { tableProcessResults = []; return; }

		const newResults = (p.args.tableProcesses ?? []).map((tp) => {
			const excluded = tp.excludedColIds ?? [];
			const activeOutColIds = (p.args.outColIds ?? []).filter((id) => !excluded.includes(id));

			// Build x values: from selected column or row indices
			const nRows = activeOutColIds.length > 0 ? (core.rawData.get(activeOutColIds[0])?.length ?? 0) : 0;
			const xVals = tp.xColId >= 0
				? (core.rawData.get(tp.xColId) ?? Array.from({ length: nRows }, (_, i) => i))
				: Array.from({ length: nRows }, (_, i) => i);

			let xWritten = false;
			return activeOutColIds.map((colId) => {
				const yOutId = tp.out?.[colId];
				const values = core.rawData.get(colId) ?? [];
				if (!values.length) return { colId, valid: false };
				const writeX = !xWritten;
				const res = applyOneTableProcess(tp, xVals, values, tp.xOutId, yOutId ?? -1, writeX);
				if (res.valid) xWritten = true;
				return { colId, ...res };
			});
		});

		untrack(() => { tableProcessResults = newResults; });
	}

	// xOutId / yOutId may be -1 in preview mode — computation still runs, writes are skipped
	function applyOneTableProcess(tp, xVals, values, xOutId, yOutId, writeX) {
		const validIdx = xVals
			.map((x, i) => (!isNaN(x) && values[i] != null && !isNaN(values[i])) ? i : -1)
			.filter((i) => i >= 0);
		if (validIdx.length < 3) return { valid: false };

		const tt = validIdx.map((i) => xVals[i]);
		const yy = validIdx.map((i) => values[i]);

		let xOut, yOut, stats;

		try {
			switch (tp.type) {
				case 'cosinor': {
					const a = tp.args;
					if (a.useFixedPeriod) {
						const fit = fitCosinorFixed(tt, yy, a.fixedPeriod ?? 24, a.nHarmonics ?? 1, a.alpha ?? 0.05);
						if (!fit) return { valid: false };
						xOut = tt; yOut = fit.fitted;
						stats = { rmse: fit.RMSE, r2: fit.R2, mesor: fit.M };
					} else {
						const fit = fitCosineCurves(tt, yy, a.Ncurves ?? 1);
						if (!fit?.fitted?.length) return { valid: false };
						xOut = tt; yOut = fit.fitted;
						stats = { rmse: fit.rmse, r2: fit.rSquared };
					}
					break;
				}
				case 'bin': {
					const a = tp.args;
					const step = a.diffStep ? (a.stepSize ?? a.binSize) : (a.binSize ?? 1);
					const res = binData(tt, yy, a.binSize ?? 1, a.binStart ?? 0, step, a.aggFunction ?? 'mean');
					if (!res?.bins?.length) return { valid: false };
					xOut = res.bins; yOut = res.y_out; stats = {};
					break;
				}
				case 'smooth': {
					const a = tp.args;
					const res = smoothArrays(tt, yy, a.smootherType ?? 'moving', a);
					if (!res?.y_out?.length) return { valid: false };
					xOut = res.x_out; yOut = res.y_out; stats = {};
					break;
				}
				case 'trend': {
					const a = tp.args;
					const res = fitTrend(tt, yy, a.model ?? 'linear', a.polyDegree ?? 2);
					if (!res?.fitted?.length) return { valid: false };
					xOut = tt; yOut = res.fitted;
					stats = { rmse: res.rmse, r2: res.rSquared };
					break;
				}
				case 'rectwave': {
					const a = tp.args;
					const fit = fitRectangularWave(tt, yy, {
						fixKappa: a.fixKappa, fixedKappa: a.fixedKappa,
						fixOmega: a.fixOmega, fixedPeriod: a.fixedPeriod,
						fixDutyCycle: a.fixDutyCycle, fixedDutyCycle: a.fixedDutyCycle
					});
					if (!fit) return { valid: false };
					xOut = tt; yOut = evaluateRectWaveAtPoints(fit.parameters, tt);
					stats = { rmse: fit.rmse, r2: fit.rSquared, period: fit.parameters?.period };
					break;
				}
				case 'dlog': {
					const a = tp.args;
					const fit = fitDoubleLogistic(tt, yy, {
						periodic: true,
						fixK1: a.fixK1, fixedK1: a.fixedK1,
						fixK2: a.fixK2, fixedK2: a.fixedK2,
						fixPeriod: a.fixPeriod, fixedPeriod: a.fixedPeriod
					});
					if (!fit) return { valid: false };
					xOut = tt; yOut = evaluateDoubleLogisticAtPoints(fit.parameters, true, tt);
					stats = { rmse: fit.rmse, r2: fit.rSquared };
					break;
				}
				default:
					return { valid: false };
			}
		} catch (e) {
			console.warn('CollectColumns table process failed:', e);
			return { valid: false };
		}

		if (!xOut || !yOut) return { valid: false };
		const hash = crypto.randomUUID();

		if (writeX && xOutId >= 0) {
			const xColOut = getColumnById(xOutId);
			if (xColOut) {
				core.rawData.set(xOutId, xOut);
				xColOut.data = xOutId;
				xColOut.type = 'number';
				xColOut.tableProcessGUId = hash;
			}
		}

		if (yOutId >= 0) {
			const yColOut = getColumnById(yOutId);
			if (yColOut) {
				core.rawData.set(yOutId, yOut);
				yColOut.data = yOutId;
				yColOut.type = 'number';
				yColOut.tableProcessGUId = hash;
			}
		}

		return { valid: true, stats };
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

		if (p.args.valid) {
			for (let i = 0; i < (p.args.tableProcesses ?? []).length; i++) {
				reconcileTableProcessOutputCols(i);
			}
			applyTableProcesses();
		}
	}

	onMount(() => {
		if (!p.args.preProcesses) p.args.preProcesses = [];
		if (!p.args.tableProcesses) p.args.tableProcesses = [];
		if (!p.args.colIds) p.args.colIds = [];
		if (!p.args.out) p.args.out = {};
		if (!p.args.outColIds) p.args.outColIds = [];

		// Migrate old tp structure: { out: { [colId]: { xOutId, yOutId } } }
		// to new: { id, xColId, xOutId, out: { [colId]: yOutId } }
		for (const tp of p.args.tableProcesses) {
			if (!tp.id) tp.id = crypto.randomUUID();
			if (tp.xColId === undefined) tp.xColId = -1;
			if (tp.xOutId === undefined) {
				const firstPair = Object.values(tp.out ?? {}).find((v) => v && typeof v === 'object');
				tp.xOutId = firstPair?.xOutId ?? -1;
				const newOut = {};
				let first = true;
				for (const [colIdStr, pair] of Object.entries(tp.out ?? {})) {
					if (pair && typeof pair === 'object') {
						if (!first && pair.xOutId >= 0) { core.rawData.delete(pair.xOutId); removeColumn(pair.xOutId); }
						newOut[colIdStr] = pair.yOutId ?? -1;
						first = false;
					} else {
						newOut[colIdStr] = pair;
					}
				}
				tp.out = newOut;
			}
		}

		const firstOutId = Object.values(p.args.out ?? {}).find((v) => typeof v === 'number' && v >= 0);
		if (firstOutId !== undefined && core.rawData.has(firstOutId) && core.rawData.get(firstOutId).length > 0) {
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
			lastHash = getHash;
		}

		preProcessProcs = p.args.preProcesses.map((pp) =>
			pp.processName ? new Process({ name: pp.processName, args: pp.processArgs }, null) : null
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
		<ColumnSelector
			multiple={true}
			bind:value={selectedColIds}
			excludeColIds={tpExcludeIds}
		/>
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
						<button class="remove-btn" onclick={() => removePreProcess(idx)} title="Remove">×</button>
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

<!-- Table Processes Section -->
{#if p.args.valid}
	<div class="section-row">
		<div class="tableProcess-label"><span>Table processes</span></div>
		<div class="control-input-vertical">
			{#each p.args.tableProcesses as tp, tpIdx (tpIdx)}
				<div class="tp-block">
					<div class="tp-header">
						<span class="tp-title">{TP_LABELS[tp.type] ?? tp.type}</span>
						<button class="remove-btn" onclick={() => removeTableProcess(tpIdx)} title="Remove">×</button>
					</div>

					<!-- X-axis column selector -->
					<div class="control-input">
						<p>X column (optional)</p>
						<ColumnSelector
							bind:value={tp.xColId}
							allowNone={true}
							onChange={() => applyTableProcesses()}
						/>
					</div>

					<!-- Type-specific parameters -->
					{#if tp.type === 'cosinor'}
						<div class="control-input">
							<label>
								<input type="checkbox" bind:checked={tp.args.useFixedPeriod} onchange={() => doCollect()} />
								Use fixed period
							</label>
						</div>
						{#if tp.args.useFixedPeriod}
							<div class="control-input-horizontal">
								<div class="control-input">
									<p>Period</p>
									<NumberWithUnits bind:value={tp.args.fixedPeriod} onInput={() => doCollect()} min="0.1" step="0.5" />
								</div>
								<div class="control-input">
									<p>N harmonics</p>
									<NumberWithUnits bind:value={tp.args.nHarmonics} onInput={() => doCollect()} min="1" step="1" />
								</div>
							</div>
							<div class="control-input">
								<p>CI level</p>
								<select bind:value={tp.args.alpha} onchange={() => doCollect()}>
									<option value={0.05}>95%</option>
									<option value={0.01}>99%</option>
								</select>
							</div>
						{:else}
							<div class="control-input">
								<p>N cosine curves</p>
								<NumberWithUnits bind:value={tp.args.Ncurves} onInput={() => doCollect()} min="1" step="1" />
							</div>
						{/if}

					{:else if tp.type === 'bin'}
						<div class="control-input-horizontal">
							<div class="control-input">
								<p>Bin size</p>
								<NumberWithUnits bind:value={tp.args.binSize} onInput={() => doCollect()} min="0.01" step="0.01" />
							</div>
							<div class="control-input">
								<p>Bin start</p>
								<NumberWithUnits bind:value={tp.args.binStart} onInput={() => doCollect()} />
							</div>
						</div>
						<div class="control-input">
							<label>
								<input type="checkbox" bind:checked={tp.args.diffStep} onchange={() => doCollect()} />
								Different step size
							</label>
						</div>
						{#if tp.args.diffStep}
							<div class="control-input">
								<p>Step size</p>
								<NumberWithUnits bind:value={tp.args.stepSize} onInput={() => doCollect()} min="0.01" step="0.01" />
							</div>
						{/if}
						<div class="control-input">
							<p>Aggregation</p>
							<select bind:value={tp.args.aggFunction} onchange={() => doCollect()}>
								<option value="mean">Mean</option>
								<option value="median">Median</option>
								<option value="min">Min</option>
								<option value="max">Max</option>
								<option value="stddev">Std dev</option>
							</select>
						</div>

					{:else if tp.type === 'smooth'}
						<div class="control-input">
							<p>Smoother</p>
							<select bind:value={tp.args.smootherType} onchange={() => doCollect()}>
								<option value="moving">Moving average</option>
								<option value="whittaker">Whittaker-Eilers</option>
								<option value="savitzky">Savitzky-Golay</option>
								<option value="loess">LOESS</option>
							</select>
						</div>
						{#if tp.args.smootherType === 'moving'}
							<div class="control-input-horizontal">
								<div class="control-input">
									<p>Window size</p>
									<NumberWithUnits bind:value={tp.args.movingAvgWindowSize} onInput={() => doCollect()} min="1" step="1" />
								</div>
								<div class="control-input">
									<p>Type</p>
									<select bind:value={tp.args.movingAvgType} onchange={() => doCollect()}>
										<option value="simple">Simple</option>
										<option value="weighted">Weighted</option>
										<option value="exponential">Exponential</option>
									</select>
								</div>
							</div>
						{:else if tp.args.smootherType === 'whittaker'}
							<div class="control-input-horizontal">
								<div class="control-input">
									<p>Lambda</p>
									<NumberWithUnits bind:value={tp.args.whittakerLambda} onInput={() => doCollect()} min="0.01" />
								</div>
								<div class="control-input">
									<p>Order</p>
									<NumberWithUnits bind:value={tp.args.whittakerOrder} onInput={() => doCollect()} min="1" max="3" step="1" />
								</div>
							</div>
						{:else if tp.args.smootherType === 'savitzky'}
							<div class="control-input-horizontal">
								<div class="control-input">
									<p>Window size</p>
									<NumberWithUnits bind:value={tp.args.savitzkyWindowSize} onInput={() => doCollect()} min="3" step="2" />
								</div>
								<div class="control-input">
									<p>Poly order</p>
									<NumberWithUnits bind:value={tp.args.savitzkyPolyOrder} onInput={() => doCollect()} min="1" step="1" />
								</div>
							</div>
						{:else if tp.args.smootherType === 'loess'}
							<div class="control-input">
								<p>Bandwidth</p>
								<NumberWithUnits bind:value={tp.args.loessBandwidth} onInput={() => doCollect()} min="0.01" max="1" step="0.05" />
							</div>
						{/if}

					{:else if tp.type === 'trend'}
						<div class="control-input">
							<p>Model</p>
							<select bind:value={tp.args.model} onchange={() => doCollect()}>
								<option value="linear">Linear</option>
								<option value="exponential">Exponential</option>
								<option value="logarithmic">Logarithmic</option>
								<option value="polynomial">Polynomial</option>
							</select>
						</div>
						{#if tp.args.model === 'polynomial'}
							<div class="control-input">
								<p>Degree</p>
								<NumberWithUnits bind:value={tp.args.polyDegree} onInput={() => doCollect()} min="2" max="8" step="1" />
							</div>
						{/if}

					{:else if tp.type === 'rectwave'}
						<div class="control-input-horizontal">
							<label class="col-check-item">
								<input type="checkbox" bind:checked={tp.args.fixOmega} onchange={() => doCollect()} />
								Fix period
							</label>
							{#if tp.args.fixOmega}
								<NumberWithUnits bind:value={tp.args.fixedPeriod} onInput={() => doCollect()} min="0.1" step="0.5" />
							{/if}
						</div>
						<div class="control-input-horizontal">
							<label class="col-check-item">
								<input type="checkbox" bind:checked={tp.args.fixKappa} onchange={() => doCollect()} />
								Fix kappa (sharpness)
							</label>
							{#if tp.args.fixKappa}
								<NumberWithUnits bind:value={tp.args.fixedKappa} onInput={() => doCollect()} min="0.1" step="0.5" />
							{/if}
						</div>
						<div class="control-input-horizontal">
							<label class="col-check-item">
								<input type="checkbox" bind:checked={tp.args.fixDutyCycle} onchange={() => doCollect()} />
								Fix duty cycle
							</label>
							{#if tp.args.fixDutyCycle}
								<NumberWithUnits bind:value={tp.args.fixedDutyCycle} onInput={() => doCollect()} min="0.01" max="0.99" step="0.05" />
							{/if}
						</div>

					{:else if tp.type === 'dlog'}
						<div class="control-input-horizontal">
							<label class="col-check-item">
								<input type="checkbox" bind:checked={tp.args.fixPeriod} onchange={() => doCollect()} />
								Fix period
							</label>
							{#if tp.args.fixPeriod}
								<NumberWithUnits bind:value={tp.args.fixedPeriod} onInput={() => doCollect()} min="0.1" step="0.5" />
							{/if}
						</div>
						<div class="control-input-horizontal">
							<label class="col-check-item">
								<input type="checkbox" bind:checked={tp.args.fixK1} onchange={() => doCollect()} />
								Fix rise rate (k1)
							</label>
							{#if tp.args.fixK1}
								<NumberWithUnits bind:value={tp.args.fixedK1} onInput={() => doCollect()} min="0.01" step="0.1" />
							{/if}
						</div>
						<div class="control-input-horizontal">
							<label class="col-check-item">
								<input type="checkbox" bind:checked={tp.args.fixK2} onchange={() => doCollect()} />
								Fix fall rate (k2)
							</label>
							{#if tp.args.fixK2}
								<NumberWithUnits bind:value={tp.args.fixedK2} onInput={() => doCollect()} min="0.01" step="0.1" />
							{/if}
						</div>
					{/if}

					<!-- Column checklist (include/exclude) -->
					{#if (p.args.outColIds ?? []).length > 0}
						{@const excluded = tp.excludedColIds ?? []}
						{@const nActive = (p.args.outColIds ?? []).length - excluded.length}
						<div class="control-input-vertical">
							<p>Columns ({nActive} of {(p.args.outColIds ?? []).length} included)</p>
							<div class="col-checklist">
								{#each p.args.outColIds ?? [] as colId (colId)}
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

					<!-- Shared x output + per-column y outputs and stats -->
					{#if tableProcessResults[tpIdx]?.some((r) => r.valid)}
						<div class="tp-outputs">
							{#if tp.xOutId >= 0}
								<div class="tp-output-row">
									<span class="tp-output-label">x (shared)</span>
									<ColumnComponent col={getColumnById(tp.xOutId)} />
								</div>
							{/if}
							{#each tableProcessResults[tpIdx] as colResult (colResult.colId)}
								{#if colResult.valid}
									{@const yOutId = tp.out?.[colResult.colId]}
									{@const srcName = getColumnById(colResult.colId)?.name ?? ''}
									<div class="tp-output-row">
										<span class="tp-output-label">{srcName}</span>
										{#if yOutId >= 0}
											<ColumnComponent col={getColumnById(yOutId)} />
										{/if}
										{#if colResult.stats?.rmse != null && !isNaN(colResult.stats.rmse)}
											<p class="tp-stat">RMSE: {colResult.stats.rmse.toFixed(3)}{colResult.stats.r2 != null ? ` · R²: ${colResult.stats.r2.toFixed(3)}` : ''}</p>
										{/if}
									</div>
								{/if}
							{/each}
						</div>
					{/if}
				</div>
			{/each}

			<select class="add-tp-select" onchange={(e) => { addTableProcess(e.target.value); e.target.value = ''; }}>
				<option value="">+ Add table process…</option>
				<option value="cosinor">Cosinor fit</option>
				<option value="bin">Bin data</option>
				<option value="smooth">Smooth data</option>
				<option value="trend">Trend fit</option>
				<option value="rectwave">Rectangular wave fit</option>
				<option value="dlog">Double logistic fit</option>
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

	.tp-outputs {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		margin-top: 0.25rem;
	}

	.tp-output-row {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}

	.tp-output-label {
		font-size: 11px;
		color: var(--color-lightness-55, #888);
	}

	.tp-stat {
		font-size: 11px;
		color: var(--color-lightness-45, #666);
		margin: 0;
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
