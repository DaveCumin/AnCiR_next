<script module>
	import {
		normalizeYInputs,
		migrateLegacyYIN,
		migrateRenamedOutKey
	} from '$lib/tableProcesses/tpArgHelpers.js';
	import { writeOutputColumn, writeXOutput } from '$lib/tableProcesses/outputColumns.js';
	import { core, appConsts } from '$lib/core/core.svelte';
	import { nodeMemo } from '$lib/core/computeMemo.js';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import ControlInput from '$lib/components/inputs/ControlInput.svelte';
	import {
		fitRectangularWave,
		evaluateRectWaveAtPoints,
		rectWaveFitWarnings
	} from '$lib/utils/rectwave.js';
	import { fitPermutationPValue, PERMUTATION_DEFAULTS } from '$lib/utils/fitFunction.js';
	import { FREE_PERIOD_DEFAULTS } from '$lib/utils/cosinor.js';
	import { periodRangeWarnings } from '$lib/utils/periodRangeWarnings.js';
	import { periodUnitForColumn, periodInputProps } from '$lib/utils/periodUnits.js';
	import { newPeriodRangeArgs } from '$lib/tableProcesses/periodRangeAuto.svelte.js';
	import {
		attachPermutation,
		permutationValidityWarnings
	} from '$lib/tableProcesses/permutationSupport.js';
	import { writeResidual, spawnResidualPlot } from '$lib/tableProcesses/residualSupport.js';
	import { isInvalidValue } from '$lib/utils/stats.js';
	import {
		fitTimeFrame,
		applyPhaseReference,
		PHASE_REFERENCE_START
	} from '$lib/utils/phaseReference.js';
	import { resolveNodePhaseReference } from '$lib/tableProcesses/phaseReferenceSupport.js';
	import { checkFitResultsFinite } from '$lib/utils/fitDomain.js';

	const displayName = 'Rectangular Wave';
	const defaults = new Map([
		['xIN', { val: -1 }],
		['yIN', { val: [] }],
		['outputX', { val: -1 }],
		['fixKappa', { val: false }],
		['fixedKappa', { val: 5 }],
		['fixOmega', { val: false }],
		['fixedPeriod', { val: 24 }],
		// Free period only: the range the fit may use, in x units (hours for a time x).
		// Unbounded, a trend with no rhythm fitted a 2,243 h "period" (review FIT-1); same
		// defaults as Cosinor, and a NEW node's range follows its x (newNodeArgs below).
		['minPeriod', { val: FREE_PERIOD_DEFAULTS.minPeriod }],
		['maxPeriod', { val: FREE_PERIOD_DEFAULTS.maxPeriod }],
		['fixDutyCycle', { val: false }],
		['fixedDutyCycle', { val: 0.5 }],
		// What hour 0 means for the acrophase (panel, stored values, stats table):
		// 'start' = hours after the first sample (x = 0 for a numeric x; the default),
		// 'clock' = hours after local midnight in the display timezone, wrapped to the
		// fitted period. Review FIT-9; utils/phaseReference.js.
		['phaseReference', { val: PHASE_REFERENCE_START }],
		// Permutation test: a model-vs-chance significance test for each y fit.
		['permuteTest', { val: PERMUTATION_DEFAULTS.permuteTest }],
		['nPermutations', { val: PERMUTATION_DEFAULTS.nPermutations }],
		['permutationSeed', { val: PERMUTATION_DEFAULTS.permutationSeed }],
		['permutationStatistic', { val: PERMUTATION_DEFAULTS.permutationStatistic }],
		['permutationScheme', { val: PERMUTATION_DEFAULTS.permutationScheme }],
		[
			'out',
			{
				rectwavex: { val: -1 },
				// The permutation test's empirical p — the ONLY p this node emits
				// (no canonical analytic test exists for this nonlinear model), so
				// the key says which test it is. Renamed from the bare `pvalue` in
				// v72.25 when Cosinor's `pvalue` became the analytic F-test p:
				// the same column name must not mean different tests on different
				// nodes. Old sessions are migrated in place (same column id).
				perm_pvalue: { val: -1 },
				// Fit quality, matching what TrendFit already exposes. Shown in the
				// panel before this; now wireable so it can be filtered or plotted.
				r2: { val: -1 },
				rmse: { val: -1 }
			}
		],
		['valid', { val: false }],
		['forcollected', { val: true }],
		['collectedType', { val: 'rectwave' }],
		['preProcesses', { val: [] }],
		['tableProcesses', { val: [] }]
	]);

	export const definition = {
		displayName,
		defaults,
		// Only a new node's period range follows its x (periodRangeAuto.svelte.js).
		newNodeArgs: newPeriodRangeArgs,
		func: rectangularwave,
		columnIdFields: { scalar: ['xIN'], array: ['yIN'] },
		xOutKey: 'rectwavex',
		yOutKeyPrefix: 'rectwavey_',
		nodeSpec: {
			id: 'tableprocess.rectangularwave',
			inputs: [
				{ name: 'xIN', kind: 'column', cardinality: 'one' },
				{ name: 'yIN', kind: 'column', cardinality: 'many' }
			],
			outputs: [
				{ name: 'rectwavex', kind: 'column', cardinality: 'one' },
				{ name: 'rectwavey_*', kind: 'column', cardinality: 'many', dynamicPrefix: 'rectwavey_' },
				{ name: 'resid_*', kind: 'column', cardinality: 'many', dynamicPrefix: 'resid_' },
				{ name: 'perm_pvalue', kind: 'column', cardinality: 'one', metric: true },
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
		const nParams = 5; // midline, amplitude, period, phase, kappa (fewer when pinned)
		if (!Number.isFinite(nUsable) || nUsable <= 0) return warnings;
		if (nUsable <= nParams) {
			warnings.push(
				`Only ${nUsable} usable points for a rectangular-wave model with ${nParams} free parameters, so the fit is interpolating, not estimating. R² here is meaningless.`
			);
		} else if (nUsable < nParams * 3) {
			warnings.push(
				`Small sample: ${nUsable} usable points for ${nParams} free parameters. A rectangular-wave fit has ~5 free parameters; with this few points the duty cycle and kappa are essentially unconstrained.`
			);
		}
		return warnings;
	}

	export function rectangularwave(argsIN) {
		// Old sessions keyed this port `pvalue`; carry the same column across to
		// the new key here too, so headless callers (MCP engine, doProcess) that
		// never instantiate the component still write into the wired column.
		migrateRenamedOutKey(argsIN, 'pvalue', 'perm_pvalue');
		const xIN = argsIN.xIN;
		const yINs = normalizeYInputs(argsIN.yIN);
		const outputXId = argsIN.outputX;
		const xOUT = argsIN.out.rectwavex;
		const fixKappa = argsIN.fixKappa ?? false;
		const fixedKappa = argsIN.fixedKappa ?? 5;
		const fixOmega = argsIN.fixOmega ?? false;
		const fixedPeriod = argsIN.fixedPeriod ?? 24;
		const fixDutyCycle = argsIN.fixDutyCycle ?? false;
		const fixedDutyCycle = argsIN.fixedDutyCycle ?? 0.5;
		const minPeriod = argsIN.minPeriod ?? FREE_PERIOD_DEFAULTS.minPeriod;
		const maxPeriod = argsIN.maxPeriod ?? FREE_PERIOD_DEFAULTS.maxPeriod;

		let result = {
			t: [],
			outputXData: null,
			y_results: {},
			originTime_ms: null
		};
		let anyValid = false;

		const canRunBase = xIN != -1 && getColumnById(xIN) && yINs.length > 0;
		if (!canRunBase) return [result, false];

		const tCol = getColumnById(xIN);
		const t = tCol.type === 'time' ? tCol.hoursSinceStart : tCol.getData();

		// Output grid in the fit's hour frame + the origin (minimum valid input time)
		// that turns hours back into timestamps (review STAT-19; utils/phaseReference.js).
		const outputXCol = outputXId != -1 ? getColumnById(outputXId) : null;
		const { outputXData, originTime_ms } = fitTimeFrame(tCol, outputXCol);

		result.outputXData = outputXData;
		result.originTime_ms = originTime_ms;
		result.phaseRef = resolveNodePhaseReference(argsIN, tCol);

		// Per-column fit outcomes: a null or all-NaN fit is reported by name rather
		// than shown as dashes with nothing to explain them.
		const fitEntries = [];

		const fixedOmega = fixOmega ? (2 * Math.PI) / fixedPeriod : null;
		// Options for the permutation fit, matching this node's fit.
		const permOptions = {
			fixKappa,
			fixedKappa,
			fixOmega,
			fixedOmega,
			fixedPeriod,
			fixDutyCycle,
			fixedDutyCycle,
			minPeriod,
			maxPeriod
		};
		// Residual-autocorrelation warnings for the shuffle permutation test (FIT-5).
		const permWarnings = [];

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

			if (tt.length < 4) continue;

			const fitResult = fitRectangularWave(tt, yy, {
				fixKappa,
				fixOmega,
				fixDutyCycle,
				fixedKappa,
				fixedOmega,
				fixedDutyCycle,
				minPeriod,
				maxPeriod
			});

			fitEntries.push({ label: `"${yCol.name}"`, result: fitResult ?? null, t: tt });

			if (fitResult) {
				const xOutData = outputXData ?? tt;
				const yOutData = outputXData
					? evaluateRectWaveAtPoints(fitResult.parameters, outputXData)
					: fitResult.fitted;

				const perm = argsIN.permuteTest
					? fitPermutationPValue(tt, yy, 'rectangular', permOptions, argsIN)
					: null;
				result.y_results[yId] = attachPermutation(
					{ fitResult, fitted: yOutData, t: tt, xOutData, yOutData },
					perm
				);
				permWarnings.push(
					...permutationValidityWarnings(
						perm,
						yy.map((v, i) => v - fitResult.fitted[i]),
						`"${yCol.name}"`
					)
				);
				if (result.t.length === 0) result.t = tt;
				anyValid = true;
			}
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
				const yOUT = argsIN.out['rectwavey_' + yId];
				const yResult = result.y_results[yId];
				if (yOUT != null && yOUT !== -1 && yResult) {
					writeOutputColumn(yOUT, yResult.yOutData, { processHash });
				}

				// Residual = observed − model evaluated at every input x (full length).
				const residId = argsIN.out['resid_' + yId];
				if (residId != null && residId !== -1 && yResult) {
					const predicted = evaluateRectWaveAtPoints(yResult.fitResult.parameters, t);
					writeResidual(residId, predicted, getColumnById(yId)?.getData() ?? [], t, processHash);
				}
			}

			// Scalar permutation-p output: one value per y input, in yIN order.
			// NaN when the test did not run — "not computed", not "not significant".
			writeOutputColumn(
				argsIN.out.perm_pvalue,
				yINs.map((yId) => result.y_results[yId]?.pValue ?? NaN),
				{ processHash }
			);
			writeOutputColumn(
				argsIN.out.r2,
				yINs.map((yId) => result.y_results[yId]?.fitResult?.rSquared ?? NaN),
				{ processHash }
			);
			writeOutputColumn(
				argsIN.out.rmse,
				yINs.map((yId) => result.y_results[yId]?.fitResult?.rmse ?? NaN),
				{ processHash }
			);
		}

		// Not gated on anyValid: when a fit fails, the point count is the explanation.
		result.warnings = [
			...checkFitResultsFinite(fitEntries, 'The rectangular-wave fit'),
			...(fixOmega
				? []
				: [
						...periodRangeWarnings(t, minPeriod, maxPeriod, { unit: periodUnitForColumn(tCol) }),
						...rectWaveFitWarnings(fitEntries, 'The free-period rectangular-wave fit', {
							unit: periodUnitForColumn(tCol)
						})
					]),
			...permWarnings,
			...(result.phaseRef?.warning ? [result.phaseRef.warning] : []),
			...fitSampleWarnings(argsIN)
		];
		return [result, anyValid];
	}
</script>

<script>
	// @ts-nocheck
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';
	import ColumnComponent from '$lib/core/Column.svelte';
	import Table from '$lib/components/plotbits/Table.svelte';
	import StoreValueButton from '$lib/components/inputs/StoreValueButton.svelte';
	import { provideStoredValueOwner } from '$lib/core/storedValueClaims.js';
	import LoadingSpinner from '$lib/components/LoadingSpinner.svelte';
	import ErrorBox from '$lib/components/reusables/ErrorBox.svelte';
	import { createComputeRunner } from '$lib/core/asyncCompute.js';
	import { clearOutputColumns } from '$lib/tableProcesses/outputColumns.js';
	import PermutationSummary from '$lib/components/PermutationSummary.svelte';
	import PhaseReferenceSelect from '$lib/components/inputs/PhaseReferenceSelect.svelte';
	import { appState } from '$lib/core/core.svelte';

	import { migrateRenamedMetricOut } from '$lib/tableProcesses/metricOutputs.js';
	import { Column, getColumnById } from '$lib/core/Column.svelte';
	import { pushObj } from '$lib/core/core.svelte.js';
	import { useMultiYTP } from '$lib/tableProcesses/useMultiYTP.svelte.js';
	import {
		usePeriodRangeAuto,
		stopFollowingX
	} from '$lib/tableProcesses/periodRangeAuto.svelte.js';
	import { formatTimeFromUNIX } from '$lib/utils/time/TimeUtils.js';
	import { onMount, untrack } from 'svelte';
	import {
		showNodeResultTable,
		saveStaticDataAsCSV
	} from '$lib/components/plotbits/helpers/save.svelte.js';
	import { useNodeResultTables } from '$lib/core/nodeResultTables.svelte.js';
	import { permutationResultTableSpec } from '$lib/tableProcesses/permutationSupport.js';

	let { p = $bindable(), hideInputs = false } = $props();
	// Every stored-value button here is one entry per node, however many copies of this
	// node are mounted (canvas + control panel): see storedValueClaims.js.
	provideStoredValueOwner('tp', () => p?.id);

	// Backward compat: convert legacy single yIN to array
	migrateLegacyYIN(p.args);
	// v72.25: the permutation p's out-key renamed `pvalue` → `perm_pvalue`.
	// Same column id under the new key (wires anchor on col_<id>, so downstream
	// consumers survive); only the seeded default column name follows the key.
	migrateRenamedMetricOut(p, 'pvalue', 'perm_pvalue');

	// Backwards compatibility — initialise any fields absent in older saved sessions
	if (p.args.fixKappa === undefined) p.args.fixKappa = false;
	if (p.args.fixedKappa === undefined) p.args.fixedKappa = 5;
	if (p.args.fixOmega === undefined) p.args.fixOmega = false;
	if (p.args.fixedPeriod === undefined) p.args.fixedPeriod = 24;
	if (p.args.minPeriod === undefined) p.args.minPeriod = FREE_PERIOD_DEFAULTS.minPeriod;
	if (p.args.maxPeriod === undefined) p.args.maxPeriod = FREE_PERIOD_DEFAULTS.maxPeriod;
	if (p.args.fixDutyCycle === undefined) p.args.fixDutyCycle = false;
	if (p.args.fixedDutyCycle === undefined) p.args.fixedDutyCycle = 0.5;
	if (p.args.permuteTest === undefined) p.args.permuteTest = PERMUTATION_DEFAULTS.permuteTest;
	if (p.args.nPermutations === undefined) p.args.nPermutations = PERMUTATION_DEFAULTS.nPermutations;
	if (p.args.permutationSeed === undefined)
		p.args.permutationSeed = PERMUTATION_DEFAULTS.permutationSeed;
	if (p.args.permutationStatistic === undefined)
		p.args.permutationStatistic = PERMUTATION_DEFAULTS.permutationStatistic;
	if (p.args.permutationScheme === undefined)
		p.args.permutationScheme = PERMUTATION_DEFAULTS.permutationScheme;

	let rwave = $state(null);

	// One entry per fitted y series, for the permutation readout under the test's controls.
	let permEntries = $derived(
		Object.entries(rwave?.y_results ?? {}).map(([yId, result]) => ({
			name: getColumnById(Number(yId))?.name ?? String(yId),
			result
		}))
	);
	let showOutputX = $state(p.args.outputX !== -1);
	let mounted = $state(false);
	let previewStart = $state(1);
	let calculating = $state(false);
	// The message of the last failed compute, shown with a Retry (ROB-11).
	let calcError = $state(null);

	const { syncYColumns, initYColumns } = useMultiYTP(p, 'rectwavey_', 'rectwave_');
	const { syncYColumns: syncResidColumns, initYColumns: initResidColumns } = useMultiYTP(
		p,
		'resid_',
		'resid_'
	);

	// Residual diagnostic: spawn a scatterplot of the input x against this Y's residual column.
	function plotResiduals(yId, yName) {
		spawnResidualPlot(p, { xId: p.args.xIN, residId: p.args.out?.['resid_' + yId], label: yName });
	}

	// Reactivity: re-run when input data or fixed-parameter settings change
	let xIN_col = $derived.by(() => (p.args.xIN >= 0 ? getColumnById(p.args.xIN) : null));
	let outputX_col = $derived.by(() => (p.args.outputX >= 0 ? getColumnById(p.args.outputX) : null));
	let xIsTime = $derived(xIN_col?.type === 'time' || outputX_col?.type === 'time');
	// The unit of every period and phase on this panel: h for a time x, else "x units".
	let periodUnit = $derived(periodUnitForColumn(xIN_col));
	// A new node's period range follows its x until the user edits it.
	usePeriodRangeAuto(p, () => xIN_col);

	let getHash = $derived.by(() => {
		let out = '';
		out += xIN_col?.getDataHash;
		for (const yId of p.args.yIN ?? []) {
			const col = yId >= 0 ? getColumnById(yId) : null;
			out += col?.getDataHash ?? '';
		}
		out += outputX_col?.getDataHash;
		out += p.args.fixKappa;
		out += p.args.fixOmega;
		out += p.args.fixDutyCycle;
		out += p.args.permuteTest;
		out += p.args.nPermutations;
		out += p.args.permutationSeed;
		out += p.args.permutationStatistic;
		// These change the result but were missing from this hash. While the memo
		// was component-local a view switch recomputed anyway and hid it; now that
		// the memo survives a remount, an omission here means an edit is ignored.
		out += '|' + p.args.fixedDutyCycle + '|' + p.args.fixedKappa + '|' + p.args.fixedPeriod;
		out += '|' + p.args.minPeriod + '|' + p.args.maxPeriod + '|' + p.args.permutationScheme;
		// Clock-time phases move with the display timezone, so it is an input then.
		out +=
			'|' +
			p.args.phaseReference +
			(p.args.phaseReference === 'clock' ? '@' + appState.displayTimezone : '');
		return out;
	});
	// Backed by the session-lifetime compute memo, so a view switch (which destroys
	// and rebuilds this component) does not recompute unchanged inputs.
	const memo = nodeMemo(p, 'tableprocess');

	// Mirror the panel state into the memo so the next mount can restore it.
	// Guarded on undefined: a fresh instance that has not computed yet must not
	// wipe a cached result another instance is still showing.
	$effect(() => {
		if (rwave !== undefined) memo.payload = rwave;
	});
	function restore(cached) {
		rwave = cached;
	}
	// Every mounted instance follows the shared result: with the node expanded on
	// the canvas AND selected in the control panel there are two, and only the
	// first to run the compute effect claims the hash and computes (see
	// computeMemo.js).
	$effect(() => memo.follow(getHash, restore));

	$effect(() => {
		const dataHash = getHash;
		if (!mounted) return;
		if (memo.hash !== dataHash) {
			memo.hash = getHash;
			untrack(() => getRwave());
		}
	});

	function onYSelectionChange() {
		const changed = syncYColumns() | syncResidColumns();
		if (changed) getRwave();
	}

	// try/finally, error state, success-only memo commit: see core/asyncCompute.js.
	const runner = createComputeRunner({
		memo,
		node: p,
		label: 'Rectangular wave fit',
		setBusy: (v) => (calculating = v),
		setError: (m) => (calcError = m)
	});
	function getRwave() {
		previewStart = 1;
		runner.run(
			untrack(() => getHash),
			() => untrack(() => rectangularwave(p.args)),
			([data, valid]) => {
				rwave = data;
				p.args.valid = valid;
				p.warnings = rwave?.warnings ?? [];
			},
			() => {
				rwave = undefined;
				p.warnings = [];
				p.args.valid = false;
				clearOutputColumns(p.args.out);
			}
		);
	}

	// Exclude own output column IDs from the Y selector
	let yExcludeIds = $derived.by(() => {
		const ids = [p.args.xIN];
		if (p.args.out.rectwavex >= 0) ids.push(p.args.out.rectwavex);
		for (const key of Object.keys(p.args.out)) {
			if ((key.startsWith('rectwavey_') || key.startsWith('resid_')) && p.args.out[key] >= 0) {
				ids.push(p.args.out[key]);
			}
		}
		return ids;
	});

	$effect(() => {
		void p.args.yIN; // dependency read: re-reconcile when the Y selection changes
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
		const restoredFromMemo = memo.has(getHash);
		if (restoredFromMemo) restore(memo.payload);
		// Create X output column if not present (needed in collected mode)
		let needsCompute = false;
		if (p.args.out.rectwavex == null || p.args.out.rectwavex < 0) {
			if (p.parent) {
				const xCol = new Column({});
				xCol.name = 'rectwavex_' + p.id;
				pushObj(xCol);
				p.parent.columnRefs = [xCol.id, ...p.parent.columnRefs];
				p.args.out.rectwavex = xCol.id;
				needsCompute = true;
			}
		}
		// Create output columns for any Y inputs that don't have them yet
		if (initYColumns()) needsCompute = true;
		if (initResidColumns()) needsCompute = true;

		if (needsCompute) {
			getRwave();
		} else if (!restoredFromMemo) {
			const xKey = p.args.out.rectwavex;
			if (xKey >= 0 && core.rawData.has(xKey) && core.rawData.get(xKey).length > 0) {
				// Check if any input columns have been replaced since session was saved
				const inputsAreStale =
					(p.args.xIN >= 0 && (getColumnById(p.args.xIN)?.rawDataVersion ?? 0) > 0) ||
					(p.args.yIN ?? []).some((id) => (getColumnById(id)?.rawDataVersion ?? 0) > 0);
				if (!inputsAreStale) {
					const y_results = {};
					for (const yId of p.args.yIN ?? []) {
						const outKey = 'rectwavey_' + yId;
						const yOutId = p.args.out[outKey];
						if (yOutId >= 0 && core.rawData.has(yOutId)) {
							y_results[yId] = {
								fitResult: null,
								fitted: core.rawData.get(yOutId),
								t: core.rawData.get(xKey)
							};
						}
					}
					rwave = {
						t: core.rawData.get(xKey),
						outputXData: null,
						y_results,
						originTime_ms: null
					};
					p.args.valid = true;
				}
				// Note: memo.hash is NOT set here, so $effect will always fire after mount
				// and recompute from current inputs regardless of staleness
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

	// The acrophase in the node's phase reference (FIT-9): untouched since first sample.
	const rwAcrophase = (fr) => applyPhaseReference(fr?.acrophase, rwave?.phaseRef, fr?.period);
	let phaseNote = $derived(rwave?.phaseRef?.clock ? 'clock time' : `${periodUnit} after start`);

	function getRwaveStatsData() {
		if (!rwave?.y_results) return { headers: [], rows: [] };
		const validEntries = Object.entries(rwave.y_results).filter(([, r]) => r.fitResult);
		if (!validEntries.length) return { headers: [], rows: [] };
		// The permutation p only appears when the test was actually run.
		const withPerm = validEntries.some(([, r]) => Number.isFinite(r.pValue));
		const headers = [
			'column',
			'rmse',
			'r2',
			...(withPerm ? ['perm_p_value'] : []),
			'period',
			rwave.phaseRef?.clock ? 'acrophase_clock_h' : 'acrophase',
			'duty_cycle',
			'kappa',
			'M',
			'A'
		];
		const rows = validEntries.map(([yId, r]) => {
			const name = getColumnById(Number(yId))?.name ?? String(yId);
			const fr = r.fitResult;
			return [
				name,
				fr.rmse,
				fr.rSquared,
				...(withPerm ? [r.pValue ?? null] : []),
				fr.period,
				rwAcrophase(fr),
				fr.parameters?.dutyCycle,
				fr.parameters?.kappa,
				fr.parameters?.M,
				fr.parameters?.A
			];
		});
		return { headers, rows };
	}

	// Publish this node's result tables live, for the Tables that "View stats" (and "View
	// permutations") open; see core/nodeResultTables.
	useNodeResultTables(() => `tableprocess_${p.id}`, {
		stats: { title: 'Rectangular wave stats', get: getRwaveStatsData },
		permutations: permutationResultTableSpec('Rectangular wave', () => permEntries)
	});
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
{/if}

<!-- Options -->
<div class="section-row">
	<div class="tableProcess-label">
		<span>Wave parameters</span>
	</div>

	<!-- Sharpness (κ) -->
	<div class="control-input-horizontal">
		<label class="control-input-checkbox">
			<input type="checkbox" bind:checked={p.args.fixKappa} onchange={getRwave} />
			<span class="ci-label">Fix sharpness (κ)</span>
		</label>
	</div>
	{#if p.args.fixKappa}
		<div class="control-input-horizontal">
			<ControlInput label="κ value">
				<NumberWithUnits bind:value={p.args.fixedKappa} min="0.1" step="0.5" onInput={getRwave} />
			</ControlInput>
		</div>
	{/if}

	<!-- Period (ω) -->
	<div class="control-input-horizontal">
		<label class="control-input-checkbox">
			<input type="checkbox" bind:checked={p.args.fixOmega} onchange={getRwave} />
			<span class="ci-label">Fix period</span>
		</label>
	</div>
	{#if p.args.fixOmega}
		<div class="control-input-horizontal">
			<!-- Time units convert to hours only for a time x; a number x's unit is its own. -->
			<ControlInput label={periodUnit === 'h' ? 'Period' : `Period (${periodUnit})`}>
				<NumberWithUnits
					bind:value={p.args.fixedPeriod}
					min="0.1"
					step="0.5"
					units={periodUnit === 'h'
						? {
								default: 'h',
								days: 24,
								h: 1,
								min: 1 / 60,
								s: 1 / (60 * 60)
							}
						: undefined}
					onInput={getRwave}
				/>
			</ControlInput>
		</div>
	{:else}
		<!-- The free period is searched for, and kept, inside this range (as Cosinor). -->
		<div class="control-input-horizontal">
			<ControlInput label={`Min period (${periodUnit})`}>
				<NumberWithUnits
					bind:value={p.args.minPeriod}
					onInput={() => {
						stopFollowingX(p.args);
						getRwave();
					}}
					{...periodInputProps(p.args.minPeriod)}
				/>
			</ControlInput>
			<ControlInput label={`Max period (${periodUnit})`}>
				<NumberWithUnits
					bind:value={p.args.maxPeriod}
					onInput={() => {
						stopFollowingX(p.args);
						getRwave();
					}}
					{...periodInputProps(p.args.maxPeriod)}
				/>
			</ControlInput>
		</div>
	{/if}

	<div class="control-input-horizontal">
		<PhaseReferenceSelect
			bind:value={p.args.phaseReference}
			xIsTime={xIN_col?.type === 'time'}
			onchange={getRwave}
		/>
	</div>

	<!-- Duty cycle (d) -->
	<div class="control-input-horizontal">
		<label class="control-input-checkbox">
			<input type="checkbox" bind:checked={p.args.fixDutyCycle} onchange={getRwave} />
			<span class="ci-label">Fix duty cycle</span>
		</label>
	</div>
	{#if p.args.fixDutyCycle}
		<div class="control-input-horizontal">
			<ControlInput label="Duty cycle (0–1)">
				<NumberWithUnits
					bind:value={p.args.fixedDutyCycle}
					min="0.01"
					max="0.99"
					step="0.05"
					onInput={getRwave}
				/>
			</ControlInput>
		</div>
	{/if}

	<!-- Permutation test -->
	<div class="control-input-horizontal">
		<label class="control-input-checkbox">
			<input type="checkbox" bind:checked={p.args.permuteTest} onchange={getRwave} />
			<span class="ci-label">Test significance (model vs chance)</span>
		</label>
	</div>
	{#if p.args.permuteTest}
		<div class="control-input-horizontal">
			<ControlInput label="Permutations">
				<NumberWithUnits bind:value={p.args.nPermutations} min="99" step="100" onInput={getRwave} />
			</ControlInput>
			<ControlInput label="Seed">
				<NumberWithUnits bind:value={p.args.permutationSeed} min="0" step="1" onInput={getRwave} />
			</ControlInput>
		</div>
		<!-- Its own row: three controls side by side overlap their labels in a canvas node. -->
		<div class="control-input-horizontal">
			<ControlInput label="Permute">
				<select bind:value={p.args.permutationScheme} onchange={getRwave}>
					<option value="shuffle">single values</option>
					<option value="block">one-period blocks</option>
				</select>
			</ControlInput>
		</div>
		<p class="hint">
			Permuting single values assumes the observations are exchangeable (independent). Time series
			are usually autocorrelated, which makes that p-value too small; one-period blocks keep the
			autocorrelation, and the Surrogate Test node offers block and AR(1) surrogates.
		</p>
		<PermutationSummary entries={permEntries} nodeId={p.id} label="Rectangular wave" />
	{/if}

	{#if !hideInputs}
		<!-- Output X -->
		<div class="control-input-horizontal">
			<label class="control-input-checkbox">
				<input
					type="checkbox"
					bind:checked={showOutputX}
					onchange={(e) => toggleOutputX(e.target.checked)}
				/>
				<span class="ci-label">Specify output x values</span>
			</label>
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

{#snippet rwaveStats(yResult, yName, yId)}
	{#if yResult?.fitResult}
		{@const fr = yResult.fitResult}
		<div class="control-input-horizontal">
			<div class="control-input">
				<p>
					Period: {fr.period.toFixed(3)}
					{periodUnit}
					<StoreValueButton
						label="Period"
						getter={() => yResult?.fitResult?.period}
						defaultName={`rectwave_period_${yName}`}
						source="Rectangular Wave"
					/>
				</p>
				<p>
					Acrophase (time of peak, {phaseNote}): {rwAcrophase(fr).toFixed(3)}
					{periodUnit}
					<StoreValueButton
						label={`Acrophase (time of peak, ${phaseNote})`}
						getter={() => rwAcrophase(yResult?.fitResult)}
						defaultName={`rectwave_acrophase_${yName}`}
						source="Rectangular Wave"
					/>
				</p>
				<p>
					Duty cycle: {(fr.parameters.dutyCycle * 100).toFixed(1)}%
					<StoreValueButton
						label="Duty cycle"
						getter={() => yResult?.fitResult?.parameters?.dutyCycle}
						defaultName={`rectwave_dutycycle_${yName}`}
						source="Rectangular Wave"
					/>
				</p>
				<p>
					Sharpness (κ): {fr.parameters.kappa.toFixed(3)}
					<StoreValueButton
						label="Kappa"
						getter={() => yResult?.fitResult?.parameters?.kappa}
						defaultName={`rectwave_kappa_${yName}`}
						source="Rectangular Wave"
					/>
				</p>
				<p>
					Half-amplitude (A): {fr.parameters.A.toFixed(3)}
					<StoreValueButton
						label="Half-amplitude"
						getter={() => yResult?.fitResult?.parameters?.A}
						defaultName={`rectwave_amplitude_${yName}`}
						source="Rectangular Wave"
					/>
				</p>
				<p>
					Midline (M): {fr.parameters.M.toFixed(3)}
					<StoreValueButton
						label="Midline"
						getter={() => yResult?.fitResult?.parameters?.M}
						defaultName={`rectwave_midline_${yName}`}
						source="Rectangular Wave"
					/>
				</p>
				<p>
					RMSE: {fr.rmse.toFixed(3)}
					<StoreValueButton
						label="RMSE"
						getter={() => yResult?.fitResult?.rmse}
						defaultName={`rectwave_rmse_${yName}`}
						source="Rectangular Wave"
					/>
				</p>
				<p>
					R²: {fr.rSquared.toFixed(3)}
					<StoreValueButton
						label="R²"
						getter={() => yResult?.fitResult?.rSquared}
						defaultName={`rectwave_r2_${yName}`}
						source="Rectangular Wave"
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
							defaultName={`rectwave_perm_p_${yName}`}
							source="Rectangular Wave (permutation)"
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
				<LoadingSpinner message="Fitting rectangular wave…" />
			{:else if calcError}
				<ErrorBox title="The fit failed." message={calcError} onretry={getRwave} />
			{:else if p.args.valid && p.args.out.rectwavex != -1}
				{@const xout = getColumnById(p.args.out.rectwavex)}
				<div class="tp-outputs">
					<div class="tp-output-row">
						<span class="tp-output-label">{getColumnById(p.args.xIN)?.name ?? 'x'} (shared)</span>
						<ColumnComponent col={xout} />
					</div>
					{#each p.args.yIN ?? [] as yId (yId)}
						{@const outKey = 'rectwavey_' + yId}
						{@const yOutId = p.args.out[outKey]}
						{#if yOutId >= 0}
							{@const yout = getColumnById(yOutId)}
							{#if yout}
								{@const yResult = rwave?.y_results?.[yId]}
								{@const srcName = getColumnById(Number(yId))?.name ?? yId}
								<div class="tp-output-row">
									<span class="tp-output-label">{srcName}</span>
									<ColumnComponent col={yout} />
									{#if yResult}
										{@render rwaveStats(yResult, srcName, yId)}
									{/if}
								</div>
							{/if}
						{/if}
					{/each}
				</div>
			{:else if p.args.valid}
				<p>Preview:</p>
				{#each Object.entries(rwave?.y_results ?? {}) as [yId, yResult] (yId)}
					{@const srcName = getColumnById(Number(yId))?.name ?? yId}
					<div class="div-line"></div>
					<p><strong>{srcName}</strong></p>
					{@render rwaveStats(yResult, srcName, yId)}
				{/each}
				{@const xData = rwave.outputXData ?? rwave.t}
				{@const yIds = Object.keys(rwave?.y_results ?? {})}
				{@const totalRows = xData.length}
				<Table
					headers={[
						'x',
						...yIds.map(
							(id) =>
								(rwave.outputXData ? 'predicted ' : 'fitted ') +
								(getColumnById(Number(id))?.name ?? id)
						)
					]}
					data={[
						xData.slice(previewStart - 1, previewStart + 5).map((x) =>
							xIsTime && rwave.originTime_ms != null
								? {
										isTime: true,
										raw: formatTimeFromUNIX(rwave.originTime_ms + x * 3600000),
										computed: x.toFixed(2)
									}
								: x.toFixed(2)
						),
						...yIds.map((id) => {
							const yr = rwave.y_results[id];
							return yr.fitted.slice(previewStart - 1, previewStart + 5).map((y) => y.toFixed(2));
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
				<p>Need valid inputs to fit a rectangular wave.</p>
			{/if}
		</div>
	</div>
</details>
{#if !calculating && p.args.valid && p.args.out.rectwavex != -1}
	<div class="tp-stat-actions">
		<button
			class="tp-stat-btn"
			onclick={() =>
				showNodeResultTable({
					sourceNodeId: `tableprocess_${p.id}`,
					resultKey: 'stats',
					title: 'Rectangular wave stats',
					get: getRwaveStatsData
				})}>View stats</button
		>
		<button
			class="tp-stat-btn"
			onclick={() => {
				const { headers, rows } = getRwaveStatsData();
				saveStaticDataAsCSV('rectwave_stats', headers, rows);
			}}>Download stats</button
		>
	</div>
{/if}

<!-- Fit-failure and sample-size cautions. Shown inline as well as on the node's
     warning badge, because the badge is a tooltip and the reason a fit shows
     dashes must be readable without hovering. Same markup as Cosinor. -->
{#each rwave?.warnings ?? [] as w (w)}
	<p class="warn">{w}</p>
{/each}

<style>
	.hint {
		font-size: var(--font-sm);
		color: var(--color-text-muted);
		margin: var(--space-1) 0 0;
	}
	/* Matches ChiSquared / Rayleigh / Cosinor / NPCRA. */
	.warn {
		font-size: var(--font-xs);
		color: var(--color-warning-text);
		background: var(--color-warning-bg);
		border-radius: var(--radius-sm);
		padding: var(--space-1) var(--space-2);
		margin: var(--space-1) 0 0;
	}
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
