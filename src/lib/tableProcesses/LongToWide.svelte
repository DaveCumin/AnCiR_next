<script module>
	// @ts-nocheck
	import { core, appConsts } from '$lib/core/core.svelte';

	export const longtowide_displayName = 'Long To Wide';
	export const longtowide_defaults = new Map([
		['categoryIN', { val: -1 }],
		['timeIN', { val: -1 }],
		['valueIN', { val: -1 }],
		['categories', { val: [] }],
		['tableProcesses', { val: [] }],
		['preProcesses', { val: [] }],
		['out', { time: { val: -1 } }],
		['valid', { val: false }]
	]);

	export function longtowide(argsIN) {
		const categoryIN = argsIN.categoryIN;
		const timeIN = argsIN.timeIN;
		const valueIN = argsIN.valueIN;

		if (
			categoryIN == undefined ||
			timeIN == undefined ||
			valueIN == undefined ||
			categoryIN == -1 ||
			timeIN == -1 ||
			valueIN == -1
		) {
			return [{}, false];
		}

		const categoryData = getColumnById(categoryIN).getData();
		const timeData = getColumnById(timeIN).getData();
		const valueData = getColumnById(valueIN).getData();

		// Build union of all time values (deduplicated, sorted)
		const seenTimes = new Set();
		const unionTimes = [];
		for (const t of timeData) {
			if (!seenTimes.has(t)) {
				seenTimes.add(t);
				unionTimes.push(t);
			}
		}
		unionTimes.sort((a, b) => a - b);

		// Get unique categories (preserving order of first appearance)
		const seenCats = new Set();
		const categories = [];
		for (const c of categoryData) {
			if (!seenCats.has(c)) {
				seenCats.add(c);
				categories.push(c);
			}
		}

		// Build a map: category -> (time -> value)
		const catTimeMap = new Map();
		for (const cat of categories) catTimeMap.set(cat, new Map());
		for (let i = 0; i < categoryData.length; i++) {
			catTimeMap.get(categoryData[i])?.set(timeData[i], valueData[i]);
		}

		// Build result object
		const result = { time: unionTimes };
		for (const cat of categories) {
			const vals = unionTimes.map((t) => {
				const v = catTimeMap.get(cat).get(t);
				return v !== undefined ? v : NaN;
			});
			result['value_' + cat] = vals;
		}

		// Write to output columns if committed
		if (argsIN.out.time !== -1) {
			// Apply pre-processes (in order) to each category's values before writing
			for (const pp of argsIN.preProcesses ?? []) {
				if (!pp.processName) continue;
				const proc = appConsts.processMap.get(pp.processName);
				if (proc?.func) {
					for (const cat of categories) {
						result['value_' + cat] = proc.func(result['value_' + cat], pp.processArgs ?? {});
					}
				}
			}

			const timeColId = argsIN.out.time;
			core.rawData.set(timeColId, unionTimes);
			getColumnById(timeColId).data = timeColId;
			getColumnById(timeColId).type = getColumnById(timeIN).type;
			if (getColumnById(timeIN).timeFormat) {
				getColumnById(timeColId).timeFormat = getColumnById(timeIN).timeFormat;
			}

			const processHash = crypto.randomUUID();
			getColumnById(timeColId).tableProcessGUId = processHash;

			for (const cat of categories) {
				const outKey = 'value_' + cat;
				const outColId = argsIN.out[outKey];
				if (outColId !== undefined && outColId !== -1) {
					core.rawData.set(outColId, result[outKey]);
					getColumnById(outColId).data = outColId;
					getColumnById(outColId).type = getColumnById(valueIN).type;
					getColumnById(outColId).tableProcessGUId = processHash;
				}
			}
		}

		return [result, unionTimes.length > 0];
	}
</script>

<script>
	// @ts-nocheck
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';
	import ColumnComponent from '$lib/core/Column.svelte';
	import Table from '$lib/components/plotbits/Table.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import { Column, getColumnById, removeColumn } from '$lib/core/Column.svelte';
	import { formatTimeFromUNIX } from '$lib/utils/time/TimeUtils.js';
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

	let longToWideResult = $state();
	let mounted = $state(false);
	let previewStart = $state(1);
	let errorMessage = $state('');

	// tableProcessResults[tpIdx] = array of { colId, valid, stats }
	let tableProcessResults = $state([]);

	// Local state bound to selectors
	let categoryIN_local = $state(p.args.categoryIN);
	let timeIN_local = $state(p.args.timeIN);
	let valueIN_local = $state(p.args.valueIN);

	// Process instances for pre-process UI
	let preProcessProcs = $state([]);

	let sortedProcesses = $derived.by(() => {
		return Array.from(appConsts.processMap.entries()).sort((a, b) => {
			const nameA = a[1].displayName || a[0];
			const nameB = b[1].displayName || b[0];
			return nameA.localeCompare(nameB);
		});
	});

	let categoryIN_col = $derived.by(() =>
		p.args.categoryIN >= 0 ? getColumnById(p.args.categoryIN) : null
	);
	let timeIN_col = $derived.by(() => (p.args.timeIN >= 0 ? getColumnById(p.args.timeIN) : null));
	let timeIsTime = $derived(timeIN_col?.type === 'time');
	let valueIN_col = $derived.by(() => (p.args.valueIN >= 0 ? getColumnById(p.args.valueIN) : null));

	let getHash = $derived.by(() => {
		let h = '';
		h += categoryIN_col?.getDataHash ?? '';
		h += timeIN_col?.getDataHash ?? '';
		h += valueIN_col?.getDataHash ?? '';
		// Track processes on output value columns
		for (const cat of p.args.categories ?? []) {
			const colId = p.args.out?.['value_' + cat];
			if (colId >= 0) {
				const col = getColumnById(colId);
				if (col) {
					h += col.processes
						.map((proc) => `${proc.id}:${proc.name}:${JSON.stringify(proc.args)}`)
						.join('|');
				}
			}
		}
		// Track preProcess changes
		h += preProcessProcs.map((proc) => `${proc?.name ?? ''}:${JSON.stringify(proc?.args ?? {})}`).join('|');
		// Track table process args/exclusions
		h += (p.args.tableProcesses ?? [])
			.map((tp) => tp.type + JSON.stringify(tp.args) + (tp.excludedColIds ?? []).join(','))
			.join('|');
		return h;
	});
	let lastHash = '';

	// Sync preProcess args back to p.args for session persistence
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
				doLongToWide();
			});
			lastHash = dataHash;
		}
	});

	// ─── Input validation ──────────────────────────────────────────────────────

	function validateInput(newVal, excludeField) {
		const id = Number(newVal);
		if (id < 0) return null;
		const outputIds = new Set(
			Object.values(p.args.out)
				.map(Number)
				.filter((v) => v >= 0)
		);
		if (outputIds.has(id)) return 'That column is an output of this transform and cannot be used as an input.';
		const inputs = { category: p.args.categoryIN, time: p.args.timeIN, value: p.args.valueIN };
		for (const [field, val] of Object.entries(inputs)) {
			if (field !== excludeField && Number(val) >= 0 && Number(val) === id) {
				return `That column is already used as the ${field} input.`;
			}
		}
		return null;
	}

	function onCategoryChange() {
		const err = validateInput(categoryIN_local, 'category');
		if (err) { errorMessage = err; categoryIN_local = p.args.categoryIN; return; }
		errorMessage = '';
		p.args.categoryIN = categoryIN_local;
		doLongToWide();
	}

	function onTimeChange() {
		const err = validateInput(timeIN_local, 'time');
		if (err) { errorMessage = err; timeIN_local = p.args.timeIN; return; }
		errorMessage = '';
		p.args.timeIN = timeIN_local;
		doLongToWide();
	}

	function onValueChange() {
		const err = validateInput(valueIN_local, 'value');
		if (err) { errorMessage = err; valueIN_local = p.args.valueIN; return; }
		errorMessage = '';
		p.args.valueIN = valueIN_local;
		doLongToWide();
	}

	// ─── Pre-process management ────────────────────────────────────────────────

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
		doLongToWide();
	}

	function removePreProcess(idx) {
		p.args.preProcesses = p.args.preProcesses.filter((_, i) => i !== idx);
		preProcessProcs = preProcessProcs.filter((_, i) => i !== idx);
		doLongToWide();
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

	// ─── Table process management ──────────────────────────────────────────────

	function addTableProcess(type) {
		if (!type) return;
		const tp = { type, excludedColIds: [], args: { ...TP_DEFAULTS[type] }, out: {} };
		p.args.tableProcesses = [...p.args.tableProcesses, tp];
		const newIdx = p.args.tableProcesses.length - 1;
		reconcileTableProcessOutputCols(newIdx);
		applyTableProcesses();
	}

	function removeTableProcess(idx) {
		const tp = p.args.tableProcesses[idx];
		for (const outPair of Object.values(tp.out ?? {})) {
			if (outPair.xOutId >= 0) { core.rawData.delete(outPair.xOutId); removeColumn(outPair.xOutId); }
			if (outPair.yOutId >= 0) { core.rawData.delete(outPair.yOutId); removeColumn(outPair.yOutId); }
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
		const activeValueColIds = (p.args.categories ?? [])
			.map((cat) => p.args.out?.['value_' + cat])
			.filter((id) => id !== undefined && id >= 0);

		// Add output col pairs for newly-appeared value columns
		for (const colId of activeValueColIds) {
			if (!tp.out[colId]) {
				if (p.parent) {
					const xCol = new Column({});
					xCol.name = `${tp.type}x_${tpIdx}_${p.id}`;
					const yCol = new Column({});
					yCol.name = `${tp.type}y_${tpIdx}_${p.id}`;
					pushObj(xCol);
					pushObj(yCol);
					p.parent.columnRefs = [xCol.id, yCol.id, ...p.parent.columnRefs];
					tp.out[colId] = { xOutId: xCol.id, yOutId: yCol.id };
				} else {
					tp.out[colId] = { xOutId: -1, yOutId: -1 };
				}
			}
		}

		// Remove output col pairs for value columns that are gone
		for (const [colIdStr, outPair] of Object.entries(tp.out)) {
			if (!activeValueColIds.includes(Number(colIdStr))) {
				if (outPair.xOutId >= 0) { core.rawData.delete(outPair.xOutId); removeColumn(outPair.xOutId); }
				if (outPair.yOutId >= 0) { core.rawData.delete(outPair.yOutId); removeColumn(outPair.yOutId); }
				delete tp.out[colIdStr];
			}
		}

		p.args.tableProcesses = [...p.args.tableProcesses];
	}

	function applyTableProcesses() {
		if (!p.args.valid || !(p.args.out?.time >= 0)) {
			tableProcessResults = [];
			return;
		}

		const timeColId = p.args.out.time;
		const timeCol = getColumnById(timeColId);
		if (!timeCol) { tableProcessResults = []; return; }

		const isTimeCol = timeCol.type === 'time';
		const times_raw = core.rawData.get(timeColId) ?? [];
		const originTime_ms = isTimeCol ? (times_raw[0] ?? 0) : null;
		const times_hrs = isTimeCol
			? times_raw.map((t) => (t - originTime_ms) / 3600000)
			: times_raw;

		const newResults = (p.args.tableProcesses ?? []).map((tp) => {
			const excluded = tp.excludedColIds ?? [];
			const activeValueColIds = (p.args.categories ?? [])
				.map((cat) => p.args.out?.['value_' + cat])
				.filter((id) => id !== undefined && id >= 0 && !excluded.includes(id));

			return activeValueColIds.map((colId) => {
				const outPair = tp.out?.[colId];
				if (!outPair || outPair.xOutId === -1 || outPair.yOutId === -1) {
					return { colId, valid: false };
				}
				const col = getColumnById(colId);
				if (!col) return { colId, valid: false };

				const values = col.getData();
				const res = applyOneTableProcess(tp, times_hrs, values, originTime_ms, isTimeCol, outPair);
				return { colId, ...res };
			});
		});

		untrack(() => { tableProcessResults = newResults; });
	}

	function applyOneTableProcess(tp, times_hrs, values, originTime_ms, isTimeCol, outPair) {
		// Filter out NaN / null pairs
		const validIdx = times_hrs
			.map((t, i) => (!isNaN(t) && values[i] != null && !isNaN(values[i])) ? i : -1)
			.filter((i) => i >= 0);
		if (validIdx.length < 3) return { valid: false };

		const tt = validIdx.map((i) => times_hrs[i]);
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
						stats = { rmse: fit.RMSE, r2: fit.R2, mesor: fit.M, harmonics: fit.harmonics };
					} else {
						const fit = fitCosineCurves(tt, yy, a.Ncurves ?? 1);
						if (!fit?.fitted?.length) return { valid: false };
						xOut = tt; yOut = fit.fitted;
						stats = { rmse: fit.rmse, r2: fit.rSquared, cosines: fit.parameters?.cosines };
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
					// smooth expects sorted data — tt from longtowide is already sorted
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
					stats = { rmse: fit.rmse, r2: fit.rSquared, period: fit.parameters?.period, dutyCycle: fit.parameters?.d };
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
			console.warn('LongToWide table process failed:', e);
			return { valid: false };
		}

		if (!xOut || !yOut) return { valid: false };

		// Write to output columns
		const xColOut = getColumnById(outPair.xOutId);
		const yColOut = getColumnById(outPair.yOutId);
		if (!xColOut || !yColOut) return { valid: false };

		const xOutFinal = isTimeCol ? xOut.map((h) => originTime_ms + h * 3600000) : xOut;
		core.rawData.set(outPair.xOutId, xOutFinal);
		xColOut.data = outPair.xOutId;
		xColOut.type = isTimeCol ? 'time' : 'number';
		if (isTimeCol) xColOut.timeFormat = null;

		core.rawData.set(outPair.yOutId, yOut);
		yColOut.data = outPair.yOutId;
		yColOut.type = 'number';

		const hash = crypto.randomUUID();
		xColOut.tableProcessGUId = hash;
		yColOut.tableProcessGUId = hash;

		return { valid: true, stats };
	}

	// ─── Main reshape ──────────────────────────────────────────────────────────

	function doLongToWide() {
		previewStart = 1;
		if (p.args.categoryIN >= 0 && p.args.timeIN >= 0 && p.args.valueIN >= 0) {
			const catData = getColumnById(p.args.categoryIN).getData();
			const seenCats = new Set();
			const categories = [];
			for (const c of catData) {
				if (!seenCats.has(c)) { seenCats.add(c); categories.push(c); }
			}

			// Remove output columns for categories that no longer exist
			const newCatSet = new Set(categories);
			for (const oldCat of p.args.categories) {
				if (!newCatSet.has(oldCat)) {
					const outKey = 'value_' + oldCat;
					const colId = p.args.out[outKey];
					if (colId !== undefined && colId >= 0) removeColumn(colId);
					delete p.args.out[outKey];
				}
			}

			p.args.categories = categories;

			// Add output columns for new categories
			const committed = p.args.out.time >= 0 && p.parent;
			for (const cat of categories) {
				const outKey = 'value_' + cat;
				if (p.args.out[outKey] === undefined || p.args.out[outKey] === -1) {
					if (committed) {
						const tempCol = new Column({});
						tempCol.name = outKey + '_' + p.id;
						p.args.out[outKey] = tempCol.id;
						pushObj(tempCol);
						p.parent.columnRefs = [tempCol.id, ...p.parent.columnRefs];
					} else {
						p.args.out[outKey] = p.args.out[outKey] ?? -1;
					}
				}
			}

			p.args.valueColIds = categories
				.map((cat) => p.args.out['value_' + cat])
				.filter((id) => id !== undefined && id >= 0);
		}

		[longToWideResult, p.args.valid] = longtowide(p.args);

		// Reconcile and run per-column table processes
		if (p.args.valid) {
			for (let i = 0; i < (p.args.tableProcesses ?? []).length; i++) {
				reconcileTableProcessOutputCols(i);
			}
			applyTableProcesses();
		}
	}

	onMount(() => {
		// Backfill tableProcesses for old sessions
		if (p.args.tableProcesses === undefined) p.args.tableProcesses = [];

		// Backfill preProcesses for old sessions
		if (p.args.preProcesses === undefined) {
			p.args.preProcesses = p.args.applyToAll?.processName
				? [p.args.applyToAll]
				: [];
		}

		// Restore preProcess instances
		preProcessProcs = p.args.preProcesses.map((pp) =>
			pp.processName ? new Process({ name: pp.processName, args: pp.processArgs }, null) : null
		);

		// Sync local selector state
		categoryIN_local = p.args.categoryIN;
		timeIN_local = p.args.timeIN;
		valueIN_local = p.args.valueIN;

		// If saved column data exists, use it immediately
		const timeKey = p.args.out.time;
		if (timeKey >= 0 && core.rawData.has(timeKey) && core.rawData.get(timeKey).length > 0) {
			const time = core.rawData.get(timeKey);
			longToWideResult = { time };
			for (const cat of p.args.categories) {
				const outColId = p.args.out['value_' + cat];
				if (outColId >= 0 && core.rawData.has(outColId)) {
					longToWideResult['value_' + cat] = core.rawData.get(outColId);
				}
			}
			p.args.valid = true;
			lastHash = getHash;
			if (!p.args.valueColIds) {
				p.args.valueColIds = p.args.categories
					.map((cat) => p.args.out['value_' + cat])
					.filter((id) => id !== undefined && id >= 0);
			}
		}

		mounted = true;
	});
</script>

<!-- Input Section -->
<div class="section-row">
	<div class="tableProcess-label"><span>Input</span></div>
	<div class="control-input-vertical">
		<div class="control-input">
			<p>Category column</p>
			<ColumnSelector bind:value={categoryIN_local} onChange={onCategoryChange} />
		</div>
		<div class="control-input">
			<p>Time column</p>
			<ColumnSelector
				bind:value={timeIN_local}
				excludeColIds={[p.args.categoryIN]}
				onChange={onTimeChange}
			/>
		</div>
		<div class="control-input">
			<p>Value column</p>
			<ColumnSelector
				bind:value={valueIN_local}
				excludeColIds={[p.args.categoryIN, p.args.timeIN]}
				onChange={onValueChange}
			/>
		</div>
		{#if errorMessage}
			<p class="error-message">{errorMessage}</p>
		{/if}
	</div>
</div>

<!-- Output / Preview -->
<div class="section-row">
	<div class="section-content">
		{#key longToWideResult}
			{#if p.args.valid && p.args.out.time >= 0}
				<div class="tableProcess-label"><span>Output</span></div>
				<ColumnComponent col={getColumnById(p.args.out.time)} />
				{#each p.args.categories as cat}
					{#if p.args.out['value_' + cat] >= 0}
						<ColumnComponent col={getColumnById(p.args.out['value_' + cat])} />
					{/if}
				{/each}
			{:else if p.args.valid && longToWideResult?.time?.length}
				{@const totalRows = longToWideResult.time.length}
				<Table
					headers={['time', ...p.args.categories]}
					data={[
						timeIsTime
							? longToWideResult.time.slice(previewStart - 1, previewStart + 5).map((t) => ({
									isTime: true,
									raw: formatTimeFromUNIX(t),
									computed: ((t - longToWideResult.time[0]) / 3600000).toFixed(2)
								}))
							: longToWideResult.time.slice(previewStart - 1, previewStart + 5),
						...p.args.categories.map((cat) =>
							longToWideResult['value_' + cat].slice(previewStart - 1, previewStart + 5)
						)
					]}
				/>
				<p>
					Row <NumberWithUnits
						min={1}
						max={Math.max(1, totalRows - 5)}
						step={1}
						bind:value={previewStart}
					/> to {Math.min(previewStart + 5, totalRows)} of {totalRows}
				</p>
			{:else}
				<p>Select valid input columns to see preview.</p>
			{/if}
		{/key}
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

					<!-- Type-specific parameters -->
					{#if tp.type === 'cosinor'}
						<div class="control-input">
							<label>
								<input type="checkbox" bind:checked={tp.args.useFixedPeriod} onchange={() => doLongToWide()} />
								Use fixed period
							</label>
						</div>
						{#if tp.args.useFixedPeriod}
							<div class="control-input-horizontal">
								<div class="control-input">
									<p>Period (hrs)</p>
									<NumberWithUnits bind:value={tp.args.fixedPeriod} onInput={() => doLongToWide()} min="0.1" step="0.5" />
								</div>
								<div class="control-input">
									<p>N harmonics</p>
									<NumberWithUnits bind:value={tp.args.nHarmonics} onInput={() => doLongToWide()} min="1" step="1" />
								</div>
							</div>
							<div class="control-input">
								<p>CI level</p>
								<select bind:value={tp.args.alpha} onchange={() => doLongToWide()}>
									<option value={0.05}>95%</option>
									<option value={0.01}>99%</option>
								</select>
							</div>
						{:else}
							<div class="control-input">
								<p>N cosine curves</p>
								<NumberWithUnits bind:value={tp.args.Ncurves} onInput={() => doLongToWide()} min="1" step="1" />
							</div>
						{/if}

					{:else if tp.type === 'bin'}
						<div class="control-input-horizontal">
							<div class="control-input">
								<p>Bin size (hrs)</p>
								<NumberWithUnits bind:value={tp.args.binSize} onInput={() => doLongToWide()} min="0.01" step="0.01" />
							</div>
							<div class="control-input">
								<p>Bin start (hr)</p>
								<NumberWithUnits bind:value={tp.args.binStart} onInput={() => doLongToWide()} />
							</div>
						</div>
						<div class="control-input">
							<label>
								<input type="checkbox" bind:checked={tp.args.diffStep} onchange={() => doLongToWide()} />
								Different step size
							</label>
						</div>
						{#if tp.args.diffStep}
							<div class="control-input">
								<p>Step size (hrs)</p>
								<NumberWithUnits bind:value={tp.args.stepSize} onInput={() => doLongToWide()} min="0.01" step="0.01" />
							</div>
						{/if}
						<div class="control-input">
							<p>Aggregation</p>
							<select bind:value={tp.args.aggFunction} onchange={() => doLongToWide()}>
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
							<select bind:value={tp.args.smootherType} onchange={() => doLongToWide()}>
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
									<NumberWithUnits bind:value={tp.args.movingAvgWindowSize} onInput={() => doLongToWide()} min="1" step="1" />
								</div>
								<div class="control-input">
									<p>Type</p>
									<select bind:value={tp.args.movingAvgType} onchange={() => doLongToWide()}>
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
									<NumberWithUnits bind:value={tp.args.whittakerLambda} onInput={() => doLongToWide()} min="0.01" />
								</div>
								<div class="control-input">
									<p>Order</p>
									<NumberWithUnits bind:value={tp.args.whittakerOrder} onInput={() => doLongToWide()} min="1" max="3" step="1" />
								</div>
							</div>
						{:else if tp.args.smootherType === 'savitzky'}
							<div class="control-input-horizontal">
								<div class="control-input">
									<p>Window size</p>
									<NumberWithUnits bind:value={tp.args.savitzkyWindowSize} onInput={() => doLongToWide()} min="3" step="2" />
								</div>
								<div class="control-input">
									<p>Poly order</p>
									<NumberWithUnits bind:value={tp.args.savitzkyPolyOrder} onInput={() => doLongToWide()} min="1" step="1" />
								</div>
							</div>
						{:else if tp.args.smootherType === 'loess'}
							<div class="control-input">
								<p>Bandwidth</p>
								<NumberWithUnits bind:value={tp.args.loessBandwidth} onInput={() => doLongToWide()} min="0.01" max="1" step="0.05" />
							</div>
						{/if}

					{:else if tp.type === 'trend'}
						<div class="control-input">
							<p>Model</p>
							<select bind:value={tp.args.model} onchange={() => doLongToWide()}>
								<option value="linear">Linear</option>
								<option value="exponential">Exponential</option>
								<option value="logarithmic">Logarithmic</option>
								<option value="polynomial">Polynomial</option>
							</select>
						</div>
						{#if tp.args.model === 'polynomial'}
							<div class="control-input">
								<p>Degree</p>
								<NumberWithUnits bind:value={tp.args.polyDegree} onInput={() => doLongToWide()} min="2" max="8" step="1" />
							</div>
						{/if}

					{:else if tp.type === 'rectwave'}
						<div class="control-input-horizontal">
							<label class="col-check-item">
								<input type="checkbox" bind:checked={tp.args.fixOmega} onchange={() => doLongToWide()} />
								Fix period
							</label>
							{#if tp.args.fixOmega}
								<NumberWithUnits bind:value={tp.args.fixedPeriod} onInput={() => doLongToWide()} min="0.1" step="0.5" />
							{/if}
						</div>
						<div class="control-input-horizontal">
							<label class="col-check-item">
								<input type="checkbox" bind:checked={tp.args.fixKappa} onchange={() => doLongToWide()} />
								Fix kappa (sharpness)
							</label>
							{#if tp.args.fixKappa}
								<NumberWithUnits bind:value={tp.args.fixedKappa} onInput={() => doLongToWide()} min="0.1" step="0.5" />
							{/if}
						</div>
						<div class="control-input-horizontal">
							<label class="col-check-item">
								<input type="checkbox" bind:checked={tp.args.fixDutyCycle} onchange={() => doLongToWide()} />
								Fix duty cycle
							</label>
							{#if tp.args.fixDutyCycle}
								<NumberWithUnits bind:value={tp.args.fixedDutyCycle} onInput={() => doLongToWide()} min="0.01" max="0.99" step="0.05" />
							{/if}
						</div>

					{:else if tp.type === 'dlog'}
						<div class="control-input-horizontal">
							<label class="col-check-item">
								<input type="checkbox" bind:checked={tp.args.fixPeriod} onchange={() => doLongToWide()} />
								Fix period
							</label>
							{#if tp.args.fixPeriod}
								<NumberWithUnits bind:value={tp.args.fixedPeriod} onInput={() => doLongToWide()} min="0.1" step="0.5" />
							{/if}
						</div>
						<div class="control-input-horizontal">
							<label class="col-check-item">
								<input type="checkbox" bind:checked={tp.args.fixK1} onchange={() => doLongToWide()} />
								Fix rise rate (k1)
							</label>
							{#if tp.args.fixK1}
								<NumberWithUnits bind:value={tp.args.fixedK1} onInput={() => doLongToWide()} min="0.01" step="0.1" />
							{/if}
						</div>
						<div class="control-input-horizontal">
							<label class="col-check-item">
								<input type="checkbox" bind:checked={tp.args.fixK2} onchange={() => doLongToWide()} />
								Fix fall rate (k2)
							</label>
							{#if tp.args.fixK2}
								<NumberWithUnits bind:value={tp.args.fixedK2} onInput={() => doLongToWide()} min="0.01" step="0.1" />
							{/if}
						</div>
					{/if}

					<!-- Column checklist (include/exclude) -->
					{#if (p.args.valueColIds ?? []).length > 0}
						{@const excluded = tp.excludedColIds ?? []}
						{@const nActive = (p.args.valueColIds ?? []).length - excluded.length}
						<div class="control-input-vertical">
							<p>Columns ({nActive} of {(p.args.valueColIds ?? []).length} included)</p>
							<div class="col-checklist">
								{#each p.args.valueColIds ?? [] as colId}
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

					<!-- Per-column output columns and stats -->
					{#if tableProcessResults[tpIdx]?.some((r) => r.valid)}
						<div class="tp-outputs">
							{#each tableProcessResults[tpIdx] as colResult}
								{#if colResult.valid}
									{@const outPair = tp.out?.[colResult.colId]}
									{@const srcName = getColumnById(colResult.colId)?.name ?? ''}
									<div class="tp-output-row">
										<span class="tp-output-label">{srcName}</span>
										{#if outPair?.xOutId >= 0}
											<ColumnComponent col={getColumnById(outPair.xOutId)} />
										{/if}
										{#if outPair?.yOutId >= 0}
											<ColumnComponent col={getColumnById(outPair.yOutId)} />
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

			<!-- Add table process dropdown -->
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
	.error-message {
		color: #c0392b;
		font-size: 12px;
		margin: 0.25rem 0;
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
		background: none;
		border: 1px dashed var(--color-lightness-75, #aaa);
		border-radius: 4px;
		cursor: pointer;
		font-size: 12px;
		padding: 0.3rem 0.6rem;
		color: var(--color-lightness-45, #666);
		width: 100%;
	}

	.add-tp-select:hover {
		border-color: var(--color-lightness-55, #888);
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

	.tp-outputs {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-top: 0.25rem;
	}

	.tp-output-row {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		border-left: 2px solid var(--color-lightness-85);
		padding-left: 0.5rem;
	}

	.tp-output-label {
		font-size: 11px;
		color: var(--color-lightness-45, #666);
		font-style: italic;
	}

	.tp-stat {
		font-size: 11px;
		color: var(--color-lightness-45, #666);
		margin: 0;
	}
</style>
