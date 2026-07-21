<script module>
	// @ts-nocheck
	import { core, appConsts } from '$lib/core/core.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import ControlInput from '$lib/components/inputs/ControlInput.svelte';
	import AttributeSelect from '$lib/components/inputs/AttributeSelect.svelte';
	import { fitTrendSync, evaluateTrendAtPoints } from '$lib/utils/trendfit.js';
	import { runComputeTask } from '$lib/workers/workerPool.js';
	import { shouldUseWorkers } from '$lib/workers/workerGate.js';
	import { normalizeYInputs, migrateLegacyYIN } from '$lib/tableProcesses/tpArgHelpers.js';
	import { writeOutputColumn, writeXOutput } from '$lib/tableProcesses/outputColumns.js';
	import { writeResidual, spawnResidualPlot } from '$lib/tableProcesses/residualSupport.js';
	import '$lib/utils/trendfit.worker-task.js';
	import { isInvalidValue } from '$lib/utils/stats.js';

	const displayName = 'Fit Trend Curves';
	const defaults = new Map([
		['xIN', { val: -1 }],
		['yIN', { val: [] }],
		['model', { val: 'linear' }],
		['polyDegree', { val: 2 }],
		['outputX', { val: -1 }],
		// `trendx` + per-y `trendy_<id>` are the fitted-curve outputs. `r2`/`rmse`
		// plus per-model `coef_*` keys are scalar metrics exposed as PORTS (one
		// value per y input, in yIN order) — see metricOutputs.js. The coef keys
		// here match the default model ('linear'); the component reconciles them
		// when the model changes.
		[
			'out',
			{
				trendx: { val: -1 },
				r2: { val: -1 },
				rmse: { val: -1 },
				coef_slope: { val: -1 },
				coef_intercept: { val: -1 }
			}
		],
		['valid', { val: false }],
		['forcollected', { val: true }],
		['collectedType', { val: 'trend' }],
		['preProcesses', { val: [] }],
		['tableProcesses', { val: [] }]
	]);

	export const definition = {
		displayName,
		defaults,
		func: trendfit,
		columnIdFields: { scalar: ['xIN'], array: ['yIN'] },
		xOutKey: 'trendx',
		yOutKeyPrefix: 'trendy_',
		nodeSpec: {
			id: 'tableprocess.trendfit',
			inputs: [
				{ name: 'xIN', kind: 'column', cardinality: 'one' },
				{ name: 'yIN', kind: 'column', cardinality: 'many' }
			],
			outputs: [
				{ name: 'trendx', kind: 'column', cardinality: 'one' },
				{ name: 'trendy_*', kind: 'column', cardinality: 'many', dynamicPrefix: 'trendy_' },
				{ name: 'resid_*', kind: 'column', cardinality: 'many', dynamicPrefix: 'resid_' },
				// Scalar-metric ports (one value per y input).
				{ name: 'r2', kind: 'column', cardinality: 'one', metric: true },
				{ name: 'rmse', kind: 'column', cardinality: 'one', metric: true },
				{
					name: 'coef_*',
					kind: 'column',
					cardinality: 'many',
					dynamicPrefix: 'coef_',
					metric: true
				}
			]
		}
	};

	/**
	 * The metric out-keys for the current model: the per-model fit coefficients.
	 * `coeffs[i]` multiplies x^i for polynomial fits, so keys are c0..cN.
	 */
	export function getCoefKeys(args) {
		const model = args?.model ?? 'linear';
		if (model === 'linear') return ['coef_slope', 'coef_intercept'];
		if (model === 'exponential' || model === 'logarithmic') return ['coef_a', 'coef_b'];
		if (model === 'polynomial') {
			const degree = Number.isFinite(args?.polyDegree) ? args.polyDegree : 2;
			return Array.from({ length: degree + 1 }, (_, i) => `coef_c${i}`);
		}
		return [];
	}

	function coefValueForKey(key, model, parameters) {
		if (!parameters) return NaN;
		if (model === 'linear') {
			return key === 'coef_slope' ? (parameters.slope ?? NaN) : (parameters.intercept ?? NaN);
		}
		if (model === 'exponential' || model === 'logarithmic') {
			return key === 'coef_a' ? (parameters.a ?? NaN) : (parameters.b ?? NaN);
		}
		if (model === 'polynomial') {
			const i = Number(key.slice('coef_c'.length));
			return parameters.coeffs?.[i] ?? NaN;
		}
		return NaN;
	}

	/**
	 * Scalar-metric ports: one value per y input, in yIN order. Reuses the exact
	 * expressions behind the per-y StoreValueButtons so the wired values match
	 * what users previously stored by name. Shared by the module func and the
	 * component's permutation-test path.
	 */
	export function writeTrendMetricOutputs(argsIN, result, processHash) {
		const yINs = normalizeYInputs(argsIN.yIN);
		const model = argsIN.model ?? 'linear';
		const coefKeys = getCoefKeys(argsIN);
		const r2Arr = [];
		const rmseArr = [];
		const coefArrs = new Map(coefKeys.map((k) => [k, []]));
		for (const yId of yINs) {
			const fd = result.y_results?.[yId]?.fittedData;
			r2Arr.push(fd?.rSquared ?? NaN);
			rmseArr.push(fd?.rmse ?? NaN);
			for (const k of coefKeys) coefArrs.get(k).push(coefValueForKey(k, model, fd?.parameters));
		}
		writeOutputColumn(argsIN.out?.r2, r2Arr, { processHash });
		writeOutputColumn(argsIN.out?.rmse, rmseArr, { processHash });
		for (const k of coefKeys) writeOutputColumn(argsIN.out?.[k], coefArrs.get(k), { processHash });
	}

	export async function trendfit(argsIN) {
		const xIN = argsIN.xIN;
		const yINs = normalizeYInputs(argsIN.yIN);
		const model = argsIN.model;
		const polyDegree = argsIN.polyDegree;
		const outputXId = argsIN.outputX;
		const xOUT = argsIN.out.trendx;

		let result = {
			t: [],
			outputXData: null,
			y_results: {}
		};
		let anyValid = false;

		if (xIN == -1 || !getColumnById(xIN) || yINs.length === 0) return [result, false];

		const tCol = getColumnById(xIN);
		const t = tCol.type === 'time' ? tCol.hoursSinceStart : tCol.getData();

		// Get outputX data if specified
		let outputXData = null;
		if (outputXId != -1 && getColumnById(outputXId)) {
			const outputXCol = getColumnById(outputXId);
			outputXData = outputXCol.type === 'time' ? outputXCol.hoursSinceStart : outputXCol.getData();
			outputXData = outputXData.filter((v) => !isInvalidValue(v));
		}
		result.outputXData = outputXData;

		// Output x type follows input x type: if either the chosen outputX column
		// or the input t column is time-typed, anchor the hour-offset results to
		// that column's first timestamp so the output column can be stored as ms
		// and typed 'time'. Mirrors the Cosinor / DoubleLogistic pattern.
		let originTime_ms = null;
		if (outputXId != -1) {
			const outputXColForOrigin = getColumnById(outputXId);
			if (outputXColForOrigin?.type === 'time') {
				originTime_ms = outputXColForOrigin.getData()[0];
			}
		}
		if (originTime_ms == null && tCol.type === 'time') {
			originTime_ms = tCol.getData()[0];
		}
		result.originTime_ms = originTime_ms;

		for (const yId of yINs) {
			if (yId == null || yId === -1) continue;
			const yCol = getColumnById(yId);
			if (!yCol) continue;

			const y = yCol.getData();
			const validIndices = t
				.map((v, i) => (isInvalidValue(v) || isInvalidValue(y[i]) ? -1 : i))
				.filter((i) => i !== -1);
			const tt = validIndices.map((i) => t[i]);
			const yy = validIndices.map((i) => y[i]);

			if (tt.length === 0) continue;

			const fittedData = shouldUseWorkers({ inputLen: tt.length })
				? await runComputeTask('trendfit.fit', { tt, yy, model, polyDegree })
				: fitTrendSync(tt, yy, model, polyDegree);
			const predicted = outputXData
				? evaluateTrendAtPoints(fittedData.parameters, model, outputXData)
				: null;

			result.y_results[yId] = {
				fittedData,
				predicted,
				t: tt,
				xOutData: outputXData ?? tt,
				yOutData: predicted ?? fittedData.fitted
			};
			if (result.t.length === 0) result.t = tt;
			if (fittedData.fitted.length > 0) anyValid = true;
		}

		// Apply pre-processes to y results before writing
		for (const pp of argsIN.preProcesses ?? []) {
			if (!pp.processName) continue;
			const proc = appConsts.processMap.get(pp.processName);
			if (proc?.func) {
				for (const yId of yINs) {
					if (result.y_results[yId]) {
						result.y_results[yId].yOutData = proc.func(
							result.y_results[yId].yOutData,
							pp.processArgs ?? {}
						);
					}
				}
			}
		}

		// Write output columns
		if (anyValid && xOUT !== -1) {
			const processHash = crypto.randomUUID();

			const firstYId = Object.keys(result.y_results)[0];
			const firstYResult = result.y_results[firstYId];
			const xOutData = firstYResult.xOutData ?? outputXData ?? firstYResult.t;
			writeXOutput(xOUT, xOutData, { originTime_ms, processHash });

			for (const yId of yINs) {
				const yOUT = argsIN.out['trendy_' + yId];
				const yResult = result.y_results[yId];
				if (yOUT != null && yOUT !== -1 && yResult) {
					writeOutputColumn(yOUT, yResult.yOutData, { processHash });
				}

				// Residual = observed − model evaluated at every input x (full length).
				const residId = argsIN.out['resid_' + yId];
				if (residId != null && residId !== -1 && yResult) {
					const predicted = evaluateTrendAtPoints(yResult.fittedData.parameters, model, t);
					writeResidual(residId, predicted, getColumnById(yId)?.getData() ?? [], t, processHash);
				}
			}

			writeTrendMetricOutputs(argsIN, result, processHash);
		}

		return [result, anyValid];
	}
</script>

<script>
	// @ts-nocheck
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';
	import ColumnComponent from '$lib/core/Column.svelte';
	import Table from '$lib/components/plotbits/Table.svelte';
	import StoreValueButton from '$lib/components/inputs/StoreValueButton.svelte';
	import LoadingSpinner from '$lib/components/LoadingSpinner.svelte';

	import { Column, getColumnById } from '$lib/core/Column.svelte';
	import { pushObj } from '$lib/core/core.svelte.js';
	import { useMultiYTP } from '$lib/tableProcesses/useMultiYTP.svelte.js';
	import { syncMetricOutColumns } from '$lib/tableProcesses/metricOutputs.js';
	import { onMount, untrack } from 'svelte';
	import {
		showStaticDataAsTable,
		saveStaticDataAsCSV
	} from '$lib/components/plotbits/helpers/save.svelte.js';
	import { fitTrend } from '$lib/utils/trendfit.js';
	import { recommendPermutations } from '$lib/utils/permutationTest.js';

	let { p = $bindable(), hideInputs = false } = $props();

	// Backward compat: convert legacy single yIN to array
	migrateLegacyYIN(p.args);

	let trendData = $state();
	let _calcToken = 0; // guards async fit results against stale overwrites
	let showOutputX = $state(p.args.outputX !== -1);
	let mounted = $state(false);
	let previewStart = $state(1);

	// Permutation test state
	let enablePermutation = $state(false);
	let nPermutations = $state(999);
	let permutationInProgress = $state(false);
	let permutationProgress = $state(0);
	let permutationSeed = $state(Math.floor(Math.random() * 2147483646));
	let autoNPermutations = $state(false);
	let permutationStatistic = $state('rSquared');

	const { syncYColumns, initYColumns } = useMultiYTP(p, 'trendy_', 'trend_');
	const { syncYColumns: syncPermColumns, initYColumns: initPermColumns } = useMultiYTP(
		p,
		'permstats_',
		'permstats_'
	);
	const { syncYColumns: syncResidColumns, initYColumns: initResidColumns } = useMultiYTP(
		p,
		'resid_',
		'resid_'
	);

	// Residual diagnostic: spawn a scatterplot of the input x against this Y's residual column.
	function plotResiduals(yId, yName) {
		spawnResidualPlot(p, { xId: p.args.xIN, residId: p.args.out?.['resid_' + yId], label: yName });
	}

	// for reactivity -----------
	let xIN_col = $derived.by(() => (p.args.xIN >= 0 ? getColumnById(p.args.xIN) : null));
	let outputX_col = $derived.by(() => (p.args.outputX >= 0 ? getColumnById(p.args.outputX) : null));
	let getHash = $derived.by(() => {
		let out = '';
		out += xIN_col?.getDataHash;
		for (const yId of p.args.yIN ?? []) {
			const col = yId >= 0 ? getColumnById(yId) : null;
			out += col?.getDataHash ?? '';
		}
		out += outputX_col?.getDataHash;
		return out;
	});
	// Init '' every mount so the $effect recomputes once after mount. The derived
	// fit stats live only in transient state and aren't persisted with the session,
	// so a mount that skipped the fit would leave the stats panel blank until a
	// param change. Mirrors RectangularWave / NonparametricRA.
	let lastHash = '';
	$effect(() => {
		const dataHash = getHash;
		if (!mounted) return;
		if (lastHash !== dataHash) {
			lastHash = getHash;
			p.args._fitHash = lastHash;
			previewStart = 1;
			const token = ++_calcToken;
			// trendfit is async now; apply when it resolves (token guards staleness).
			trendfit(p.args).then(([data, valid]) => {
				if (token !== _calcToken) return;
				untrack(() => {
					trendData = data;
					p.args.valid = valid;
				});
			});
		}
	});

	function onYSelectionChange() {
		const fitColsChanged = syncYColumns();
		const permColsChanged = syncPermColumns();
		const residColsChanged = syncResidColumns();
		if (fitColsChanged || permColsChanged || residColsChanged) getTrend();
	}

	//------------
	async function getTrend() {
		previewStart = 1;

		if (enablePermutation && p.args.yIN && p.args.yIN.length > 0) {
			permutationInProgress = true;
			permutationProgress = 0;

			const xIN = p.args.xIN;
			const yINs = p.args.yIN;
			const model = p.args.model;
			const polyDegree = p.args.polyDegree;

			const xCol = getColumnById(xIN);
			const t = xCol.type === 'time' ? xCol.hoursSinceStart : xCol.getData();

			// Build result with permutation tests
			let result = {
				t: [],
				outputXData: null,
				y_results: {}
			};

			for (const yId of yINs) {
				if (yId == null || yId === -1) continue;
				const yCol = getColumnById(yId);
				if (!yCol) continue;

				const y = yCol.getData();
				const validIndices = t
					.map((v, i) => (isInvalidValue(v) || isInvalidValue(y[i]) ? -1 : i))
					.filter((i) => i !== -1);
				const tt = validIndices.map((i) => t[i]);
				const yy = validIndices.map((i) => y[i]);

				if (tt.length === 0) continue;

				// Determine recommended permutations if auto mode
				const nPerms = autoNPermutations ? recommendPermutations(tt.length) : nPermutations;

				// Run async fit with permutation test
				const fittedData = await fitTrend(tt, yy, model, polyDegree, {
					permuteTest: true,
					nPermutations: nPerms,
					testStatistic: permutationStatistic,
					seed: permutationSeed,
					onProgress: (current, total) => {
						permutationProgress = Math.round((current / total) * 100);
					}
				});

				const predicted = fitTrendSync(tt, yy, model, polyDegree);
				result.y_results[yId] = {
					fittedData,
					predicted: null,
					t: tt,
					xOutData: tt,
					yOutData: fittedData.fitted
				};

				if (result.t.length === 0) result.t = tt;
			}

			const anyValid = Object.values(result.y_results).some(
				(r) => (r?.fittedData?.fitted?.length ?? 0) > 0
			);
			if (anyValid && p.args.out.trendx !== -1) {
				const processHash = crypto.randomUUID();
				const firstYId = Object.keys(result.y_results)[0];
				const firstYResult = result.y_results[firstYId];
				const xOutData = firstYResult?.xOutData ?? result.outputXData ?? firstYResult?.t ?? [];
				writeOutputColumn(p.args.out.trendx, xOutData, { processHash });

				for (const yId of yINs) {
					const yResult = result.y_results[yId];
					const yOutId = p.args.out['trendy_' + yId];
					if (yOutId != null && yOutId !== -1 && yResult) {
						writeOutputColumn(yOutId, yResult.yOutData ?? [], { processHash });
					}

					writeOutputColumn(
						p.args.out['permstats_' + yId],
						Array.isArray(yResult?.fittedData?.permutedStats)
							? yResult.fittedData.permutedStats
							: [],
						{ processHash }
					);

					const residId = p.args.out['resid_' + yId];
					if (residId != null && residId !== -1 && yResult) {
						const predicted = evaluateTrendAtPoints(yResult.fittedData.parameters, model, t);
						writeResidual(residId, predicted, getColumnById(yId)?.getData() ?? [], t, processHash);
					}
				}

				writeTrendMetricOutputs(p.args, result, processHash);
			}

			trendData = result;
			p.args.valid = Object.keys(result.y_results).length > 0;
			permutationInProgress = false;
			lastHash = getHash;
			p.args._fitHash = lastHash;
		} else {
			[trendData, p.args.valid] = await trendfit(p.args);
			for (const yId of p.args.yIN ?? []) {
				// Clear stale permutation stats (no processHash — GUId untouched).
				writeOutputColumn(p.args.out['permstats_' + yId], []);
			}
			lastHash = getHash;
			p.args._fitHash = lastHash;
		}
	}

	// Exclude own output column IDs from the Y selector
	let yExcludeIds = $derived.by(() => {
		if (hideInputs) return [];
		const ids = [p.args.xIN];
		if (p.args.out.trendx >= 0) ids.push(p.args.out.trendx);
		for (const key of Object.keys(p.args.out)) {
			if (
				(key.startsWith('trendy_') || key.startsWith('resid_') || key.startsWith('permstats_')) &&
				p.args.out[key] >= 0
			) {
				ids.push(p.args.out[key]);
			}
		}
		return ids;
	});

	// Reconcile output columns when yIN changes externally (e.g. from parent in collected mode)
	$effect(() => {
		const _yIN = p.args.yIN;
		if (!mounted) return;
		queueMicrotask(() => untrack(() => onYSelectionChange()));
	});

	// The metric keys this node owns: r2/rmse always, plus per-model coef_*.
	const METRIC_KEY_RE = /^(r2|rmse|coef_)/;
	function syncTrendMetricColumns() {
		return syncMetricOutColumns(p, ['r2', 'rmse', ...getCoefKeys(p.args)], (k) =>
			METRIC_KEY_RE.test(k)
		);
	}

	// Reconcile coef_* metric columns when the model (or poly degree) changes.
	// Deferred out of the effect: syncMetricOutColumns constructs Columns, which
	// must not happen under an active reaction (derived_inert).
	$effect(() => {
		void p.args.model;
		void p.args.polyDegree;
		if (!mounted) return;
		queueMicrotask(() =>
			untrack(() => {
				if (syncTrendMetricColumns()) getTrend();
			})
		);
	});

	onMount(() => {
		if (!p.args.out) p.args.out = {};
		// Ensure X output column exists
		if ((p.args.out.trendx == null || p.args.out.trendx < 0) && p.parent) {
			const xCol = new Column({});
			xCol.name = 'trendx_' + p.id;
			pushObj(xCol);
			p.parent.columnRefs = [xCol.id, ...p.parent.columnRefs];
			p.args.out.trendx = xCol.id;
		}
		// Backfill metric out-columns for sessions saved before they existed.
		const needsCompute = [
			syncTrendMetricColumns(),
			initYColumns(),
			initPermColumns(),
			initResidColumns()
		].some(Boolean);

		if (needsCompute) {
			getTrend();
		} else {
			const xKey = p.args.out.trendx;
			if (xKey >= 0 && core.rawData.has(xKey) && core.rawData.get(xKey).length > 0) {
				const y_results = {};
				for (const yId of p.args.yIN ?? []) {
					const outKey = 'trendy_' + yId;
					const yOutId = p.args.out[outKey];
					if (yOutId >= 0 && core.rawData.has(yOutId)) {
						y_results[yId] = {
							fittedData: {
								fitted: core.rawData.get(yOutId),
								parameters: {},
								rmse: NaN,
								rSquared: NaN
							},
							predicted: null,
							t: core.rawData.get(xKey)
						};
					}
				}
				trendData = {
					t: core.rawData.get(xKey),
					outputXData: null,
					y_results
				};
				p.args.valid = true;
				// NOTE: lastHash deliberately NOT set here — the rehydrated trendData
				// holds only the fitted curve, not the derived stats, so let the
				// $effect recompute them once after mount (curve above is a placeholder).
			}
		}
		mounted = true;
	});

	function toggleOutputX(checked) {
		if (!checked) {
			p.args.outputX = -1;
		} else {
			p.args.outputX = p.args.xIN;
		}
	}

	function getTrendStatsData() {
		if (!trendData?.y_results) return { headers: [], rows: [] };
		const model = p.args.model ?? 'linear';
		const validEntries = Object.entries(trendData.y_results).filter(
			([, r]) => (r.fittedData?.fitted?.length ?? 0) > 0
		);
		if (!validEntries.length) return { headers: [], rows: [] };
		const includePermutation = validEntries.some(
			([, r]) =>
				Number.isFinite(r.fittedData?.pValue) || typeof r.fittedData?.significant === 'boolean'
		);
		let paramHeaders;
		if (model === 'linear') {
			paramHeaders = ['slope', 'intercept'];
		} else if (model === 'exponential' || model === 'logarithmic') {
			paramHeaders = ['a', 'b'];
		} else {
			const maxC = Math.max(
				...validEntries.map(([, r]) => r.fittedData?.parameters?.coeffs?.length ?? 0)
			);
			paramHeaders = Array.from({ length: maxC }, (_, i) => `c${i}`);
		}
		const headers = [
			'column',
			'rmse',
			'r2',
			...paramHeaders,
			...(includePermutation ? ['pValue', 'significant'] : [])
		];
		const rows = validEntries.map(([yId, r]) => {
			const name = getColumnById(Number(yId))?.name ?? String(yId);
			const row = [name, r.fittedData.rmse, r.fittedData.rSquared];
			if (model === 'linear') {
				row.push(
					r.fittedData.parameters?.slope ?? null,
					r.fittedData.parameters?.intercept ?? null
				);
			} else if (model === 'exponential' || model === 'logarithmic') {
				row.push(r.fittedData.parameters?.a ?? null, r.fittedData.parameters?.b ?? null);
			} else {
				for (const c of r.fittedData.parameters?.coeffs ?? []) row.push(c);
				while (row.length < 3 + paramHeaders.length) row.push(null);
			}
			if (includePermutation) {
				row.push(
					r.fittedData?.pValue ?? null,
					typeof r.fittedData?.significant === 'boolean' ? r.fittedData.significant : null
				);
			}
			return row;
		});
		return { headers, rows };
	}
</script>

{#if !hideInputs}
	<!-- Input Section -->
	<div class="section-row">
		<div class="tableProcess-label">
			<span>Input</span>
		</div>

		<div class="control-input-vertical">
			<div class="control-input">
				<p>X column</p>
				<ColumnSelector bind:value={p.args.xIN} />
			</div>

			<div class="control-input-vertical">
				<div class="control-input">
					<p>Y columns</p>
					<ColumnSelector
						bind:value={p.args.yIN}
						excludeColIds={yExcludeIds}
						multiple={true}
						onChange={onYSelectionChange}
					/>
				</div>
			</div>
		</div>
	</div>
{/if}

<!-- Process Section -->
<div class="section-row">
	<div class="tableProcess-label">
		<span>Trend parameters</span>
	</div>

	<div class="control-input-horizontal">
		<div class="control-input">
			<p>Model</p>
			<AttributeSelect
				bind:value={p.args.model}
				options={['linear', 'exponential', 'logarithmic', 'polynomial']}
				optionsDisplay={['Linear', 'Exponential', 'Logarithmic', 'Polynomial']}
				onChange={() => getTrend()}
			/>
		</div>
	</div>

	{#if p.args.model === 'polynomial'}
		<div class="control-input-horizontal">
			<ControlInput label="Degree">
				<NumberWithUnits
					bind:value={p.args.polyDegree}
					onInput={() => getTrend()}
					min="1"
					step="1"
				/>
			</ControlInput>
		</div>
	{/if}

	<!-- Permutation Test Controls -->
	<div class="control-input-horizontal">
		<div class="control-input">
			<label>
				<input type="checkbox" bind:checked={enablePermutation} disabled={permutationInProgress} />
				Permutation test (for significance)
			</label>
		</div>
	</div>

	{#if enablePermutation}
		<div
			class="control-input-vertical"
			style="background-color: var(--color-lightness-95); padding: 10px; border-radius: var(--radius-sm); margin: 10px 0;"
		>
			<div class="control-input">
				<label>
					<input
						type="checkbox"
						bind:checked={autoNPermutations}
						disabled={permutationInProgress}
					/>
					Auto (based on data size)
				</label>
			</div>

			{#if !autoNPermutations}
				<ControlInput label="Permutations">
					<NumberWithUnits
						bind:value={nPermutations}
						min="99"
						max="9999"
						step="100"
						disabled={permutationInProgress}
					/>
				</ControlInput>
			{/if}

			<div class="control-input">
				<p>Statistic</p>
				<AttributeSelect
					bind:value={permutationStatistic}
					options={['rSquared', 'rmse']}
					optionsDisplay={['R²', 'RMSE']}
					disabled={permutationInProgress}
				/>
			</div>

			<ControlInput label="Seed (for reproducibility)">
				<NumberWithUnits
					bind:value={permutationSeed}
					min="1"
					max="2147483646"
					step="1"
					disabled={permutationInProgress}
				/>
			</ControlInput>

			<button onclick={() => getTrend()} disabled={permutationInProgress} style="margin-top: 10px;">
				{#if permutationInProgress}
					Testing... {permutationProgress}%
				{:else}
					Run Permutation Test
				{/if}
			</button>
		</div>
	{/if}

	{#if !hideInputs}
		<div class="control-input-horizontal">
			<div class="control-input">
				<label>
					<input
						type="checkbox"
						bind:checked={showOutputX}
						onchange={(e) => toggleOutputX(e.target.checked)}
					/>
					Specify output x values
				</label>
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

{#snippet trendStats(yResult, yName, yId)}
	<div class="control-input-horizontal">
		<div class="control-input">
			<p>
				R²: {yResult?.fittedData?.rSquared?.toFixed(3)}
				<StoreValueButton
					label="R²"
					getter={() => yResult?.fittedData?.rSquared}
					defaultName={`trend_r2_${yName}`}
					source={'Trend Fit (' + p.args.model + ')'}
				/>
				&ensp;RMSE: {yResult?.fittedData?.rmse?.toFixed(3)}
				<StoreValueButton
					label="RMSE"
					getter={() => yResult?.fittedData?.rmse}
					defaultName={`trend_rmse_${yName}`}
					source={'Trend Fit (' + p.args.model + ')'}
				/>
			</p>
			{#if yId != null && p.args.out?.['resid_' + yId] >= 0}
				<button
					class="tp-stat-btn"
					onclick={() => plotResiduals(yId, yName)}
					title="Scatter the residuals (observed − fitted) against the input x to check the fit">Plot residuals</button
				>
			{/if}
			{#if Array.isArray(yResult?.fittedData?.permutedStats) && yResult.fittedData.permutedStats.length > 0 && Number.isFinite(yResult?.fittedData?.pValue)}
				<p
					style="color: {yResult.fittedData.significant
						? 'var(--color-success)'
						: 'var(--color-warning)'}; font-weight: 600;"
				>
					Perm p-value: {yResult?.fittedData?.pValue?.toFixed(4)}
					{#if yResult.fittedData.significant}
						✓ Significant (p &lt; 0.05)
					{:else}
						⚠ Not significant (p ≥ 0.05)
					{/if}
				</p>
			{/if}
		</div>
	</div>
	<div class="control-input-horizontal">
		<div class="control-input">
			{#if p.args.model === 'linear'}
				<p>
					Slope: {yResult?.fittedData?.parameters?.slope?.toFixed(2)}
					<StoreValueButton
						label="Slope"
						getter={() => yResult?.fittedData?.parameters?.slope}
						defaultName={`trend_slope_${yName}`}
						source="Trend Fit (linear)"
					/>
				</p>
				<p>
					Intercept: {yResult?.fittedData?.parameters?.intercept?.toFixed(2)}
					<StoreValueButton
						label="Intercept"
						getter={() => yResult?.fittedData?.parameters?.intercept}
						defaultName={`trend_intercept_${yName}`}
						source="Trend Fit (linear)"
					/>
				</p>
			{:else if p.args.model === 'exponential'}
				<p>
					a: {yResult?.fittedData?.parameters?.a?.toFixed(2)}
					<StoreValueButton
						label="a"
						getter={() => yResult?.fittedData?.parameters?.a}
						defaultName={`trend_a_${yName}`}
						source="Trend Fit (exponential)"
					/>
				</p>
				<p>
					b: {yResult?.fittedData?.parameters?.b?.toFixed(2)}
					<StoreValueButton
						label="b"
						getter={() => yResult?.fittedData?.parameters?.b}
						defaultName={`trend_b_${yName}`}
						source="Trend Fit (exponential)"
					/>
				</p>
			{:else if p.args.model === 'logarithmic'}
				<p>
					a: {yResult?.fittedData?.parameters?.a?.toFixed(2)}
					<StoreValueButton
						label="a"
						getter={() => yResult?.fittedData?.parameters?.a}
						defaultName={`trend_a_${yName}`}
						source="Trend Fit (logarithmic)"
					/>
				</p>
				<p>
					b: {yResult?.fittedData?.parameters?.b?.toFixed(2)}
					<StoreValueButton
						label="b"
						getter={() => yResult?.fittedData?.parameters?.b}
						defaultName={`trend_b_${yName}`}
						source="Trend Fit (logarithmic)"
					/>
				</p>
			{:else if p.args.model === 'polynomial'}
				{#each yResult?.fittedData?.parameters?.coeffs ?? [] as c, i}
					<p>
						c{i}: {c.toFixed(2)}
						<StoreValueButton
							label={'c' + i}
							getter={() => yResult?.fittedData?.parameters?.coeffs?.[i]}
							defaultName={`trend_c${i}_${yName}`}
							source="Trend Fit (polynomial)"
						/>
					</p>
				{/each}
			{/if}
			<p>
				Equation:
				{#if p.args.model === 'linear'}
					{yResult?.fittedData?.parameters?.slope?.toFixed(2)}*x + {yResult?.fittedData?.parameters?.intercept?.toFixed(
						2
					)}
				{:else if p.args.model === 'exponential'}
					{yResult?.fittedData?.parameters?.a?.toFixed(
						2
					)}*exp({yResult?.fittedData?.parameters?.b?.toFixed(2)}*x)
				{:else if p.args.model === 'logarithmic'}
					{yResult?.fittedData?.parameters?.a?.toFixed(2)} + {yResult?.fittedData?.parameters?.b?.toFixed(
						2
					)}*ln(x)
				{:else if p.args.model === 'polynomial'}
					{yResult?.fittedData?.parameters?.coeffs
						?.map((c, i) => `${c.toFixed(2)}*x^${i}`)
						.join(' + ')}
				{/if}
			</p>
		</div>
	</div>
{/snippet}

<!-- Output Section -->
<details open>
	<summary class="section-details-summary">Output</summary>
	{#if permutationInProgress}
		<LoadingSpinner message="Running permutation test" detail="{permutationProgress}% complete" />
	{:else}
		<div class="section-row">
			<div class="section-content">
				{#if p.args.valid && p.args.out.trendx != -1}
					{@const xout = getColumnById(p.args.out.trendx)}
					<div class="tp-outputs">
						<div class="tp-output-row">
							<span class="tp-output-label">{getColumnById(p.args.xIN)?.name ?? 'x'} (shared)</span>
							<ColumnComponent col={xout} />
						</div>
						{#each p.args.yIN ?? [] as yId}
							{@const outKey = 'trendy_' + yId}
							{@const yOutId = p.args.out[outKey]}
							{#if yOutId >= 0}
								{@const yout = getColumnById(yOutId)}
								{#if yout}
									{@const yResult = trendData?.y_results?.[yId]}
									{@const srcName = getColumnById(Number(yId))?.name ?? yId}
									{@const permOutKey = 'permstats_' + yId}
									{@const permOutId = p.args.out[permOutKey]}
									{@const permOut = permOutId >= 0 ? getColumnById(permOutId) : null}
									<div class="tp-output-row">
										<span class="tp-output-label">{srcName}</span>
										<ColumnComponent col={yout} />
										{#if permOut}
											<ColumnComponent col={permOut} />
										{/if}
										{#if yResult}
											{@render trendStats(yResult, srcName, yId)}
										{/if}
									</div>
								{/if}
							{/if}
						{/each}
					</div>
				{:else if p.args.valid}
					<p>Preview:</p>
					{#each Object.entries(trendData?.y_results ?? {}) as [yId, yResult]}
						{@const srcName = getColumnById(Number(yId))?.name ?? yId}
						<div class="div-line"></div>
						<p><strong>{srcName}</strong></p>
						{@render trendStats(yResult, srcName, yId)}
					{/each}
					{@const xData = trendData.outputXData ?? trendData.t}
					{@const yIds = Object.keys(trendData?.y_results ?? {})}
					{@const totalRows = xData.length}
					<Table
						headers={[
							'x',
							...yIds.map(
								(id) =>
									(trendData.outputXData ? 'predicted ' : 'fitted ') +
									(getColumnById(Number(id))?.name ?? id)
							)
						]}
						data={[
							xData.slice(previewStart - 1, previewStart + 5).map((x) => x.toFixed(2)),
							...yIds.map((id) => {
								const yr = trendData.y_results[id];
								const yData = yr.predicted ?? yr.fittedData.fitted;
								return yData.slice(previewStart - 1, previewStart + 5).map((x) => x.toFixed(2));
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
					<p>Need to have valid inputs to create columns.</p>
				{/if}
			</div>
		</div>
	{/if}
</details>
{#if p.args.valid && p.args.out.trendx != -1}
	<div class="tp-stat-actions">
		<button
			class="tp-stat-btn"
			onclick={() => {
				const { headers, rows } = getTrendStatsData();
				showStaticDataAsTable('Trend fit stats', headers, rows, getTrendStatsData, `tableprocess_${p.id}`);
			}}>View stats</button
		>
		<button
			class="tp-stat-btn"
			onclick={() => {
				const { headers, rows } = getTrendStatsData();
				saveStaticDataAsCSV('trend_fit_stats', headers, rows);
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
