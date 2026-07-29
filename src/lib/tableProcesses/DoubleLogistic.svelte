<script module>
	import { migrateLegacyYIN } from '$lib/tableProcesses/tpArgHelpers.js';
	import { writeOutputColumn, writeXOutput } from '$lib/tableProcesses/outputColumns.js';
	import { core, appConsts } from '$lib/core/core.svelte';
	import { nodeMemo } from '$lib/core/computeMemo.js';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import ControlInput from '$lib/components/inputs/ControlInput.svelte';
	import { fitDoubleLogistic, evaluateDoubleLogisticAtPoints } from '$lib/utils/doublelogistic.js';
	import { fitPermutationPValue, PERMUTATION_DEFAULTS } from '$lib/utils/fitFunction.js';
	import { attachPermutation } from '$lib/tableProcesses/permutationSupport.js';
	import { writeResidual, spawnResidualPlot } from '$lib/tableProcesses/residualSupport.js';
	import { runComputeTask } from '$lib/workers/workerPool.js';
	import { shouldUseWorkers } from '$lib/workers/workerGate.js';
	import '$lib/utils/doublelogistic.worker-task.js';
	import { isInvalidValue } from '$lib/utils/stats.js';

	const displayName = 'Double Logistic';
	const defaults = new Map([
		['xIN', { val: -1 }],
		['yIN', { val: [] }],
		['outputX', { val: -1 }],
		['fixK1', { val: false }],
		['fixedK1', { val: 0.5 }],
		['fixK2', { val: false }],
		['fixedK2', { val: 0.5 }],
		['fixPeriod', { val: false }],
		['fixedPeriod', { val: 24 }],
		// Permutation test: a model-vs-chance significance test for each y fit.
		['permuteTest', { val: PERMUTATION_DEFAULTS.permuteTest }],
		['nPermutations', { val: PERMUTATION_DEFAULTS.nPermutations }],
		['permutationSeed', { val: PERMUTATION_DEFAULTS.permutationSeed }],
		['permutationStatistic', { val: PERMUTATION_DEFAULTS.permutationStatistic }],
		[
			'out',
			{
				dlogx: { val: -1 },
				pvalue: { val: -1 },
				// Fit quality, matching TrendFit / RectangularWave.
				r2: { val: -1 },
				rmse: { val: -1 }
			}
		],
		['valid', { val: false }],
		['forcollected', { val: true }],
		['collectedType', { val: 'dlog' }],
		['preProcesses', { val: [] }],
		['tableProcesses', { val: [] }]
	]);

	export const definition = {
		displayName,
		defaults,
		func: doublelogistic,
		columnIdFields: { scalar: ['xIN'], array: ['yIN'] },
		xOutKey: 'dlogx',
		yOutKeyPrefix: 'dlogy_',
		nodeSpec: {
			id: 'tableprocess.doublelogistic',
			inputs: [
				{ name: 'xIN', kind: 'column', cardinality: 'one' },
				{ name: 'yIN', kind: 'column', cardinality: 'many' }
			],
			outputs: [
				{ name: 'dlogx', kind: 'column', cardinality: 'one' },
				{ name: 'dlogy_*', kind: 'column', cardinality: 'many', dynamicPrefix: 'dlogy_' },
				{ name: 'resid_*', kind: 'column', cardinality: 'many', dynamicPrefix: 'resid_' },
				{ name: 'pvalue', kind: 'column', cardinality: 'one', metric: true },
				{ name: 'r2', kind: 'column', cardinality: 'one', metric: true },
				{ name: 'rmse', kind: 'column', cardinality: 'one', metric: true }
			]
		}
	};

	// Self-contained sample-size check for this node. A fit needs meaningfully
	// more usable points than it has free parameters before its R² and p-value
	// mean anything; at n = nParams the model interpolates exactly and R² = 1.
	function fitSampleWarnings(argsIN) {
		const warnings = [];
		const xId = argsIN.xIN;
		const xCol = xId != null && xId !== -1 ? getColumnById(xId) : null;
		const yIds = Array.isArray(argsIN.yIN) ? argsIN.yIN : [argsIN.yIN];
		const yCol = yIds?.[0] != null && yIds[0] !== -1 ? getColumnById(yIds[0]) : null;
		if (!xCol || !yCol) return warnings;
		const xs = (xCol.type === 'time' ? xCol.hoursSinceStart : xCol.getData()) ?? [];
		const ys = yCol.getData() ?? [];
		let nUsable = 0;
		for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
			const a = Number(xs[i]);
			const b = Number(ys[i]);
			if (xs[i] != null && ys[i] != null && Number.isFinite(a) && Number.isFinite(b)) nUsable++;
		}
		const nParams = 6; // mesor, amplitude, onset, offset, k1, k2
		if (!Number.isFinite(nUsable) || nUsable <= 0) return warnings;
		if (nUsable <= nParams) {
			warnings.push(
				`Only ${nUsable} usable points for a double-logistic model with ${nParams} free parameters — the fit is interpolating, not estimating. R² here is meaningless.`
			);
		} else if (nUsable < nParams * 3) {
			warnings.push(
				`Small sample: ${nUsable} usable points for ${nParams} free parameters. A double-logistic fit has ~6 free parameters; with this few points onset/offset and the slopes are essentially unconstrained.`
			);
		}
		return warnings;
	}

	export async function doublelogistic(argsIN) {
		const xIN = argsIN.xIN;
		const yINraw = argsIN.yIN;
		const yINs = Array.isArray(yINraw) ? yINraw : yINraw != null && yINraw !== -1 ? [yINraw] : [];
		const outputXId = argsIN.outputX;
		const fixK1 = argsIN.fixK1 ?? false;
		const fixedK1 = argsIN.fixedK1 ?? 0.5;
		const fixK2 = argsIN.fixK2 ?? false;
		const fixedK2 = argsIN.fixedK2 ?? 0.5;
		const fixPeriod = argsIN.fixPeriod ?? false;
		const fixedPeriod = argsIN.fixedPeriod ?? 24;

		if (xIN == -1 || !getColumnById(xIN) || yINs.length === 0) return [null, false];

		const tCol = getColumnById(xIN);
		const t = tCol.type === 'time' ? tCol.hoursSinceStart : tCol.getData();

		// Output X data
		let outputXData = null;
		if (outputXId != -1 && getColumnById(outputXId)) {
			const outputXCol = getColumnById(outputXId);
			outputXData = outputXCol.type === 'time' ? outputXCol.hoursSinceStart : outputXCol.getData();
			outputXData = outputXData.filter((v) => !isInvalidValue(v));
		}

		// Origin time for datetime display
		let originTime_ms = null;
		if (outputXId != -1) {
			const col = getColumnById(outputXId);
			if (col?.type === 'time') originTime_ms = col.getData()[0];
		}
		if (originTime_ms == null && tCol.type === 'time') {
			originTime_ms = tCol.getData()[0];
		}

		const y_results = {};
		let sharedT = null;

		for (const yId of yINs) {
			const yCol = getColumnById(yId);
			if (!yCol) continue;

			const y = yCol.getData();
			const validIndices = t
				.map((v, i) => (isInvalidValue(v) || isInvalidValue(y[i]) ? -1 : i))
				.filter((i) => i !== -1);
			const tt = validIndices.map((i) => t[i]);
			const yy = validIndices.map((i) => y[i]);

			if (tt.length < 4) continue;
			if (!sharedT) sharedT = tt;

			const dlOpts = {
				periodic: true,
				fixK1,
				fixK2,
				fixPeriod,
				fixedK1,
				fixedK2,
				fixedPeriod
			};
			const fitResult = shouldUseWorkers({ inputLen: tt.length })
				? await runComputeTask('doublelogistic.fit', { tt, yy, opts: dlOpts })
				: fitDoubleLogistic(tt, yy, dlOpts);

			if (fitResult) {
				const xOutData = outputXData ?? tt;
				const yOutData = outputXData
					? evaluateDoubleLogisticAtPoints(fitResult.parameters, true, outputXData)
					: fitResult.fitted;

				y_results[yId] = attachPermutation(
					{ fitResult, fitted: yOutData, t: tt, xOutData, yOutData },
					argsIN.permuteTest ? fitPermutationPValue(tt, yy, 'doublelogistic', dlOpts, argsIN) : null
				);
			}
		}

		if (Object.keys(y_results).length === 0) return [null, false];

		// Apply pre-processes to y results before writing
		for (const pp of argsIN.preProcesses ?? []) {
			if (!pp.processName) continue;
			const proc = appConsts.processMap.get(pp.processName);
			if (proc?.func) {
				for (const yId of Object.keys(y_results)) {
					if (y_results[yId]?.yOutData) {
						y_results[yId].yOutData = proc.func(y_results[yId].yOutData, pp.processArgs ?? {});
					}
				}
			}
		}

		// Write shared X output (and, when it lands, the per-Y curves under the
		// same hash).
		const finalXData = outputXData ?? sharedT;
		const processHash = crypto.randomUUID();
		if (writeXOutput(argsIN.out.dlogx, finalXData, { originTime_ms, processHash })) {
			for (const yId of Object.keys(y_results)) {
				writeOutputColumn(argsIN.out['dlogy_' + yId], y_results[yId].yOutData, { processHash });

				// Residual = observed − model evaluated at every input x (full length).
				const residId = argsIN.out['resid_' + yId];
				if (residId != null && residId !== -1) {
					const predicted = evaluateDoubleLogisticAtPoints(
						y_results[yId].fitResult.parameters,
						true,
						t
					);
					writeResidual(residId, predicted, getColumnById(yId)?.getData() ?? [], t, processHash);
				}
			}
		}

		// Scalar p-value output: one value per y input, in yIN order.
		const fitHash = crypto.randomUUID();
		writeOutputColumn(
			argsIN.out.pvalue,
			yINs.map((yId) => y_results[yId]?.pValue ?? NaN),
			{ processHash: fitHash }
		);
		writeOutputColumn(
			argsIN.out.r2,
			yINs.map((yId) => y_results[yId]?.fitResult?.rSquared ?? NaN),
			{ processHash: fitHash }
		);
		writeOutputColumn(
			argsIN.out.rmse,
			yINs.map((yId) => y_results[yId]?.fitResult?.rmse ?? NaN),
			{ processHash: fitHash }
		);

		return [
			{ t: sharedT, outputXData, y_results, originTime_ms, warnings: fitSampleWarnings(argsIN) },
			true
		];
	}
</script>

<script>
	// @ts-nocheck
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';
	import ColumnComponent from '$lib/core/Column.svelte';
	import Table from '$lib/components/plotbits/Table.svelte';
	import StoreValueButton from '$lib/components/inputs/StoreValueButton.svelte';
	import LoadingSpinner from '$lib/components/LoadingSpinner.svelte';
	import PermutationSummary from '$lib/components/PermutationSummary.svelte';

	import { Column, getColumnById } from '$lib/core/Column.svelte';
	import { pushObj } from '$lib/core/core.svelte.js';
	import { useMultiYTP } from '$lib/tableProcesses/useMultiYTP.svelte.js';
	import { formatTimeFromUNIX } from '$lib/utils/time/TimeUtils.js';
	import { onMount, untrack } from 'svelte';
	import {
		showStaticDataAsTable,
		saveStaticDataAsCSV
	} from '$lib/components/plotbits/helpers/save.svelte.js';

	let { p = $bindable(), hideInputs = false } = $props();

	// Backwards compatibility: convert single yIN to array
	migrateLegacyYIN(p.args);
	// Migrate old single dlogy key to per-Y key
	if (p.args.out.dlogy != null) {
		const oldY = p.args.out.dlogy;
		delete p.args.out.dlogy;
		if (oldY >= 0 && p.args.yIN.length === 1) {
			p.args.out['dlogy_' + p.args.yIN[0]] = oldY;
		}
	}

	if (p.args.fixK1 === undefined) p.args.fixK1 = false;
	if (p.args.fixedK1 === undefined) p.args.fixedK1 = 0.5;
	if (p.args.fixK2 === undefined) p.args.fixK2 = false;
	if (p.args.fixedK2 === undefined) p.args.fixedK2 = 0.5;
	if (p.args.fixPeriod === undefined) p.args.fixPeriod = false;
	if (p.args.fixedPeriod === undefined) p.args.fixedPeriod = 24;
	if (p.args.permuteTest === undefined) p.args.permuteTest = PERMUTATION_DEFAULTS.permuteTest;
	if (p.args.nPermutations === undefined) p.args.nPermutations = PERMUTATION_DEFAULTS.nPermutations;
	if (p.args.permutationSeed === undefined)
		p.args.permutationSeed = PERMUTATION_DEFAULTS.permutationSeed;
	if (p.args.permutationStatistic === undefined)
		p.args.permutationStatistic = PERMUTATION_DEFAULTS.permutationStatistic;

	let dlData = $state(null);

	// One entry per fitted y series, for the permutation readout under the test's controls.
	let permEntries = $derived(
		Object.entries(dlData?.y_results ?? {}).map(([yId, result]) => ({
			name: getColumnById(Number(yId))?.name ?? String(yId),
			result
		}))
	);
	let showOutputX = $state(p.args.outputX !== -1);
	let mounted = $state(false);
	let previewStart = $state(1);
	let calculating = $state(false);
	let _calcToken = 0;

	const { syncYColumns, initYColumns } = useMultiYTP(p, 'dlogy_', 'dlog_');
	const { syncYColumns: syncResidColumns, initYColumns: initResidColumns } = useMultiYTP(
		p,
		'resid_',
		'resid_'
	);

	// Residual diagnostic: spawn a scatterplot of the input x against this Y's residual column.
	function plotResiduals(yId, yName) {
		spawnResidualPlot(p, { xId: p.args.xIN, residId: p.args.out?.['resid_' + yId], label: yName });
	}

	// Called when Y selection changes in the multi-select.
	function onYSelectionChange() {
		if (syncYColumns() | syncResidColumns()) getFit();
	}

	let yExcludeIds = $derived.by(() => {
		const ids = [p.args.xIN, p.args.out.dlogx];
		for (const yId of p.args.yIN ?? []) {
			if (p.args.out['dlogy_' + yId] >= 0) ids.push(p.args.out['dlogy_' + yId]);
			if (p.args.out['resid_' + yId] >= 0) ids.push(p.args.out['resid_' + yId]);
		}
		return ids.filter((id) => id >= 0);
	});

	let xIN_col = $derived.by(() => (p.args.xIN >= 0 ? getColumnById(p.args.xIN) : null));
	let outputX_col = $derived.by(() => (p.args.outputX >= 0 ? getColumnById(p.args.outputX) : null));
	let xIsTime = $derived(xIN_col?.type === 'time' || outputX_col?.type === 'time');

	let getHash = $derived.by(() => {
		let out = '';
		out += xIN_col?.getDataHash;
		for (const yId of p.args.yIN ?? []) {
			const yCol = getColumnById(yId);
			out += yCol?.getDataHash;
		}
		out += outputX_col?.getDataHash;
		out += p.args.fixK1;
		out += p.args.fixK2;
		out += p.args.fixPeriod;
		out += p.args.permuteTest;
		out += p.args.nPermutations;
		out += p.args.permutationSeed;
		out += p.args.permutationStatistic;
		// These change the result but were missing from this hash. While the memo
		// was component-local a view switch recomputed anyway and hid it; now that
		// the memo survives a remount, an omission here means an edit is ignored.
		out += '|' + p.args.fixedK1 + '|' + p.args.fixedK2 + '|' + p.args.fixedPeriod;
		return out;
	});
	// Backed by the session-lifetime compute memo, so a view switch (which destroys
	// and rebuilds this component) does not recompute unchanged inputs.
	const memo = nodeMemo(p, 'tableprocess');

	// Mirror the panel state into the memo so the next mount can restore it.
	// Guarded on undefined: a fresh instance that has not computed yet must not
	// wipe a cached result another instance is still showing.
	$effect(() => {
		if (dlData !== undefined) memo.payload = dlData;
	});

	$effect(() => {
		const dataHash = getHash;
		if (!mounted) return;
		if (memo.hash !== dataHash) {
			memo.hash = getHash;
			calculating = true;
			const token = ++_calcToken;
			setTimeout(async () => {
				if (token !== _calcToken) return;
				const [data, valid] = await doublelogistic(p.args);
				if (token !== _calcToken) return; // re-check after await (analysis is async now)
				untrack(() => {
					previewStart = 1;
					dlData = data;
					p.args.valid = valid;
					calculating = false;
				});
			}, 0);
		}
	});

	function getFit() {
		previewStart = 1;
		calculating = true;
		const token = ++_calcToken;
		setTimeout(async () => {
			if (token !== _calcToken) return;
			const [data, valid] = await doublelogistic(p.args);
			if (token !== _calcToken) return; // re-check after await (analysis is async now)
			dlData = data;
			p.args.valid = valid;
			p.warnings = data?.warnings ?? [];
			calculating = false;
			memo.hash = getHash;
		}, 0);
	}

	$effect(() => {
		const _yIN = p.args.yIN;
		if (!mounted) return;
		queueMicrotask(() => untrack(() => onYSelectionChange()));
	});

	onMount(() => {
		// Put the previous result back before anything else: the compute effect
		// skips when nothing changed, and this state died with the last instance.
		// Whether the cached result came back. The placeholder branch below must not
		// overwrite it: that placeholder carries no stats (rmse NaN, no parameters), and
		// since the memo already holds this hash the compute effect will not fire to
		// replace it — so the panel would stay stat-less until an input changed.
		const restoredFromMemo = memo.payload !== undefined && memo.hash === getHash;
		if (restoredFromMemo) dlData = memo.payload;
		// Create X output column if not present (needed in collected mode)
		let needsCompute = false;
		if (p.args.out.dlogx == null || p.args.out.dlogx < 0) {
			if (p.parent) {
				const xCol = new Column({});
				xCol.name = 'dlogx_' + p.id;
				pushObj(xCol);
				p.parent.columnRefs = [xCol.id, ...p.parent.columnRefs];
				p.args.out.dlogx = xCol.id;
				needsCompute = true;
			}
		}
		// Create output columns for any Y inputs that don't have them yet
		if (initYColumns()) needsCompute = true;
		if (initResidColumns()) needsCompute = true;

		if (needsCompute) {
			getFit();
		} else if (!restoredFromMemo) {
			const xKey = p.args.out.dlogx;
			if (xKey >= 0 && core.rawData.has(xKey) && core.rawData.get(xKey).length > 0) {
				const y_results = {};
				for (const yId of p.args.yIN ?? []) {
					const outKey = 'dlogy_' + yId;
					const yOutId = p.args.out[outKey];
					if (yOutId >= 0 && core.rawData.has(yOutId)) {
						y_results[yId] = {
							fitResult: null,
							fitted: core.rawData.get(yOutId),
							t: core.rawData.get(xKey),
							xOutData: core.rawData.get(xKey),
							yOutData: core.rawData.get(yOutId)
						};
					}
				}
				if (Object.keys(y_results).length > 0) {
					dlData = { t: core.rawData.get(xKey), outputXData: null, y_results, originTime_ms: null };
					p.args.valid = true;
				}
			}
		}
		// NOTE: memo.hash deliberately NOT set here — rehydrated dlData holds only the
		// fitted curve (fitResult: null), not the derived stats, so let the $effect
		// recompute them once after mount.
		mounted = true;
	});

	function toggleOutputX(checked) {
		p.args.outputX = checked ? p.args.xIN : -1;
	}

	/** Safe toFixed — returns '—' for null/undefined/NaN/Infinity */
	function fmt(val, decimals = 3) {
		if (val == null || !isFinite(val)) return '—';
		return val.toFixed(decimals);
	}

	function getDlogStatsData() {
		if (!dlData?.y_results) return { headers: [], rows: [] };
		const validEntries = Object.entries(dlData.y_results).filter(([, r]) => r.fitResult);
		if (!validEntries.length) return { headers: [], rows: [] };
		// The permutation p only appears when the test was actually run.
		const withPerm = validEntries.some(([, r]) => Number.isFinite(r.pValue));
		const headers = [
			'column',
			'rmse',
			'r2',
			...(withPerm ? ['perm_p_value'] : []),
			'period',
			'M',
			'A',
			'k1',
			'onset',
			'k2',
			'offset'
		];
		const rows = validEntries.map(([yId, r]) => {
			const name = getColumnById(Number(yId))?.name ?? String(yId);
			const fr = r.fitResult;
			return [
				name,
				fr.rmse,
				fr.rSquared,
				...(withPerm ? [r.pValue ?? null] : []),
				fr.parameters?.T,
				fr.parameters?.M,
				fr.parameters?.A,
				fr.parameters?.k1,
				fr.parameters?.t1,
				fr.parameters?.k2,
				fr.parameters?.t2
			];
		});
		return { headers, rows };
	}
</script>

{#if !hideInputs}
	<!-- Input -->
	<div class="section-row">
		<div class="tableProcess-label">
			<span>Input</span>
		</div>
		<div class="control-input-vertical">
			<div class="control-input">
				<p>X column</p>
				<ColumnSelector bind:value={p.args.xIN} />
			</div>
			<div class="control-input">
				<p>Y column(s)</p>
				<ColumnSelector
					bind:value={p.args.yIN}
					excludeColIds={yExcludeIds}
					multiple={true}
					onChange={onYSelectionChange}
				/>
			</div>
		</div>
	</div>
{/if}

<!-- Options -->
<div class="section-row">
	<div class="tableProcess-label">
		<span>Model parameters</span>
	</div>

	<!-- Period -->
	<div class="control-input-horizontal">
		<div class="control-input-checkbox">
			<input type="checkbox" bind:checked={p.args.fixPeriod} onchange={getFit} />
			<p>Fix period</p>
		</div>
	</div>
	{#if p.args.fixPeriod}
		<div class="control-input-horizontal">
			<ControlInput label="Period">
				<NumberWithUnits
					bind:value={p.args.fixedPeriod}
					min="0.1"
					step="0.5"
					units={{ default: 'hrs', days: 24, hrs: 1, mins: 1 / 60, secs: 1 / (60 * 60) }}
					onInput={getFit}
				/>
			</ControlInput>
		</div>
	{/if}

	<!-- Rise rate (k1) -->
	<div class="control-input-horizontal">
		<div class="control-input-checkbox">
			<input type="checkbox" bind:checked={p.args.fixK1} onchange={getFit} />
			<p>Fix rise rate (k1)</p>
		</div>
	</div>
	{#if p.args.fixK1}
		<div class="control-input-horizontal">
			<ControlInput label="k1 (1/hr)">
				<NumberWithUnits bind:value={p.args.fixedK1} min="0.001" step="0.05" onInput={getFit} />
			</ControlInput>
		</div>
	{/if}

	<!-- Fall rate (k2) -->
	<div class="control-input-horizontal">
		<div class="control-input-checkbox">
			<input type="checkbox" bind:checked={p.args.fixK2} onchange={getFit} />
			<p>Fix fall rate (k2)</p>
		</div>
	</div>
	{#if p.args.fixK2}
		<div class="control-input-horizontal">
			<ControlInput label="k2 (1/hr)">
				<NumberWithUnits bind:value={p.args.fixedK2} min="0.001" step="0.05" onInput={getFit} />
			</ControlInput>
		</div>
	{/if}

	<!-- Permutation test -->
	<div class="control-input-horizontal">
		<div class="control-input-checkbox">
			<input type="checkbox" bind:checked={p.args.permuteTest} onchange={getFit} />
			<p>Test significance (model vs chance)</p>
		</div>
	</div>
	{#if p.args.permuteTest}
		<div class="control-input-horizontal">
			<ControlInput label="Permutations">
				<NumberWithUnits bind:value={p.args.nPermutations} min="99" step="100" onInput={getFit} />
			</ControlInput>
			<ControlInput label="Seed">
				<NumberWithUnits bind:value={p.args.permutationSeed} min="0" step="1" onInput={getFit} />
			</ControlInput>
		</div>
		<PermutationSummary entries={permEntries} nodeId={p.id} label="Double logistic" />
	{/if}

	{#if !hideInputs}
		<!-- Output X -->
		<div class="control-input-horizontal">
			<div class="control-input-checkbox">
				<input
					type="checkbox"
					bind:checked={showOutputX}
					onchange={(e) => toggleOutputX(e.target.checked)}
				/>
				<p>Specify output x values</p>
			</div>
		</div>
		{#if showOutputX}
			<div class="control-input-vertical">
				<div class="control-input">
					<p>Output X column</p>
					<ColumnSelector bind:value={p.args.outputX} excludeColIds={yExcludeIds} />
				</div>
			</div>
		{/if}
	{/if}
</div>

{#snippet dlogStats(yResult, yName, yId)}
	{#if yResult?.fitResult}
		{@const fr = yResult.fitResult}
		{@const p_ = fr.parameters}
		<div class="control-input-horizontal">
			<div class="control-input">
				<p>
					Period: {fmt(p_.T)} hrs
					<StoreValueButton
						label="Period"
						getter={() => yResult?.fitResult?.parameters?.T}
						defaultName={`dlog_period_${yName}`}
						source="Double Logistic"
					/>
				</p>
				<p>
					Onset phase: {fmt(fr.onsetPhase)} hrs
					<StoreValueButton
						label="Onset phase"
						getter={() => yResult?.fitResult?.onsetPhase}
						defaultName={`dlog_onset_${yName}`}
						source="Double Logistic"
					/>
				</p>
				<p>
					Offset phase: {fmt(fr.offsetPhase)} hrs
					<StoreValueButton
						label="Offset phase"
						getter={() => yResult?.fitResult?.offsetPhase}
						defaultName={`dlog_offset_${yName}`}
						source="Double Logistic"
					/>
				</p>
				<p>
					Duty cycle: {fmt(fr.dutyCycle != null ? fr.dutyCycle * 100 : null, 1)}%
					<StoreValueButton
						label="Duty cycle"
						getter={() => yResult?.fitResult?.dutyCycle}
						defaultName={`dlog_dutycycle_${yName}`}
						source="Double Logistic"
					/>
				</p>
				<p>
					Rise rate (k1): {fmt(p_.k1, 4)} /hr
					<StoreValueButton
						label="Rise rate"
						getter={() => yResult?.fitResult?.parameters?.k1}
						defaultName={`dlog_k1_${yName}`}
						source="Double Logistic"
					/>
				</p>
				<p>
					Fall rate (k2): {fmt(p_.k2, 4)} /hr
					<StoreValueButton
						label="Fall rate"
						getter={() => yResult?.fitResult?.parameters?.k2}
						defaultName={`dlog_k2_${yName}`}
						source="Double Logistic"
					/>
				</p>
				<p>
					Amplitude (A): {fmt(p_.A)}
					<StoreValueButton
						label="Amplitude"
						getter={() => yResult?.fitResult?.parameters?.A}
						defaultName={`dlog_amplitude_${yName}`}
						source="Double Logistic"
					/>
				</p>
				<p>
					Mesor (M): {fmt(p_.M)}
					<StoreValueButton
						label="Mesor"
						getter={() => yResult?.fitResult?.parameters?.M}
						defaultName={`dlog_mesor_${yName}`}
						source="Double Logistic"
					/>
				</p>
				<p>
					RMSE: {fmt(fr.rmse)}
					<StoreValueButton
						label="RMSE"
						getter={() => yResult?.fitResult?.rmse}
						defaultName={`dlog_rmse_${yName}`}
						source="Double Logistic"
					/>
				</p>
				<p>
					R²: {fmt(fr.rSquared)}
					<StoreValueButton
						label="R²"
						getter={() => yResult?.fitResult?.rSquared}
						defaultName={`dlog_r2_${yName}`}
						source="Double Logistic"
					/>
				</p>
				{#if Number.isFinite(yResult?.pValue)}
					<p
						style="color: {yResult.significant
							? 'var(--color-success)'
							: 'var(--color-warning-text)'}; font-weight: 600;"
					>
						Permutation p: {yResult.pValue.toFixed(4)}
						{#if yResult.significant}
							✓ Significant (p &lt; 0.05)
						{:else}
							⚠ Not significant (p ≥ 0.05)
						{/if}
						<StoreValueButton
							label="Permutation p"
							getter={() => yResult?.pValue}
							defaultName={`dlog_perm_p_${yName}`}
							source="Double Logistic (permutation)"
						/>
					</p>
				{/if}
				{#if yId != null && p.args.out?.['resid_' + yId] >= 0}
					<button
						class="tp-stat-btn"
						onclick={() => plotResiduals(yId, yName)}
						title="Scatter the residuals (observed − fitted) against the input x to check the fit"
						>Plot residuals</button
					>
				{/if}
			</div>
		</div>
	{/if}
{/snippet}

<!-- Output -->
<details open>
	<summary class="section-details-summary">Output</summary>
	<div class="section-row">
		<div class="section-content">
			{#if calculating}
				<LoadingSpinner message="Fitting double logistic…" />
			{:else if p.args.valid && p.args.out.dlogx != -1}
				{@const xout = getColumnById(p.args.out.dlogx)}
				<div class="tp-outputs">
					<div class="tp-output-row">
						<span class="tp-output-label">{getColumnById(p.args.xIN)?.name ?? 'x'} (shared)</span>
						<ColumnComponent col={xout} />
					</div>
					{#each p.args.yIN ?? [] as yId}
						{@const outKey = 'dlogy_' + yId}
						{@const yOutId = p.args.out[outKey]}
						{#if yOutId >= 0}
							{@const yout = getColumnById(yOutId)}
							{#if yout}
								{@const yResult = dlData?.y_results?.[yId]}
								{@const srcName = getColumnById(Number(yId))?.name ?? yId}
								<div class="tp-output-row">
									<span class="tp-output-label">{srcName}</span>
									<ColumnComponent col={yout} />
									{#if yResult}
										{@render dlogStats(yResult, srcName, yId)}
									{/if}
								</div>
							{/if}
						{/if}
					{/each}
				</div>
			{:else if p.args.valid}
				<p>Preview:</p>
				{#each Object.entries(dlData?.y_results ?? {}) as [yId, yResult]}
					{@const srcName = getColumnById(Number(yId))?.name ?? yId}
					<div class="div-line"></div>
					<p><strong>{srcName}</strong></p>
					{@render dlogStats(yResult, srcName, yId)}
				{/each}
				{@const xData = dlData.outputXData ?? dlData.t}
				{@const yIds = Object.keys(dlData?.y_results ?? {})}
				{@const totalRows = xData.length}
				<Table
					headers={[
						'x',
						...yIds.map(
							(id) =>
								(dlData.outputXData ? 'predicted ' : 'fitted ') +
								(getColumnById(Number(id))?.name ?? id)
						)
					]}
					data={[
						xData.slice(previewStart - 1, previewStart + 5).map((x) =>
							xIsTime && dlData.originTime_ms != null
								? {
										isTime: true,
										raw: formatTimeFromUNIX(dlData.originTime_ms + x * 3600000),
										computed: fmt(x, 2)
									}
								: fmt(x, 2)
						),
						...yIds.map((id) => {
							const yr = dlData.y_results[id];
							return yr.fitted.slice(previewStart - 1, previewStart + 5).map((y) => fmt(y, 2));
						})
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
				<p>Need valid inputs to fit a double logistic.</p>
			{/if}
		</div>
	</div>
</details>
{#if !calculating && p.args.valid && p.args.out.dlogx != -1}
	<div class="tp-stat-actions">
		<button
			class="tp-stat-btn"
			onclick={() => {
				const { headers, rows } = getDlogStatsData();
				showStaticDataAsTable(
					'Double logistic stats',
					headers,
					rows,
					getDlogStatsData,
					`tableprocess_${p.id}`
				);
			}}>View stats</button
		>
		<button
			class="tp-stat-btn"
			onclick={() => {
				const { headers, rows } = getDlogStatsData();
				saveStaticDataAsCSV('double_logistic_stats', headers, rows);
			}}>Download stats</button
		>
	</div>
{/if}

<style>
	.tp-stat-actions {
		display: flex;
		gap: 0.4rem;
		margin-top: 0.3rem;
	}

	.tp-stat-btn {
		font-size: var(--font-xs);
		padding: var(--space-2) var(--space-4);
		border: 1px solid var(--color-lightness-75);
		border-radius: var(--radius-xs);
		background: none;
		cursor: pointer;
		color: var(--color-lightness-35);
	}

	.tp-stat-btn:hover {
		background: var(--color-lightness-95);
		border-color: var(--color-lightness-55);
	}
</style>
