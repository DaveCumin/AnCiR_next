<script module>
	// @ts-nocheck
	import { core, appConsts } from '$lib/core/core.svelte';
	import { fitCurveModel, evaluateCurveModelAtPoints } from '$lib/utils/fitFunction.js';

	const displayName = 'Fit Function';
	const defaults = new Map([
		['xIN', { val: -1 }],
		['yIN', { val: [] }],
		['model', { val: 'cosinor' }],
		['outputX', { val: -1 }],
		['out', { fitx: { val: -1 } }],
		['valid', { val: false }],
		['forcollected', { val: true }],
		['collectedType', { val: 'fit' }],
		['preProcesses', { val: [] }],
		['tableProcesses', { val: [] }],
		['useFixedPeriod', { val: true }],
		['fixedPeriod', { val: 24 }],
		['Ncurves', { val: 1 }],
		['nHarmonics', { val: 1 }],
		['alpha', { val: 0.05 }],
		['fixKappa', { val: false }],
		['fixedKappa', { val: 5 }],
		['fixOmega', { val: false }],
		['fixDutyCycle', { val: false }],
		['fixedDutyCycle', { val: 0.5 }],
		['periodic', { val: true }],
		['fixK1', { val: false }],
		['fixedK1', { val: 0.5 }],
		['fixK2', { val: false }],
		['fixedK2', { val: 0.5 }],
		['permuteTest', { val: false }],
		['autoPermutations', { val: false }],
		['nPermutations', { val: 999 }],
		['permutationSeed', { val: 12345 }],
		['permutationStatistic', { val: 'rSquared' }]
	]);

	export const definition = {
		displayName,
		defaults,
		func: fitFunction,
		columnIdFields: { scalar: ['xIN'], array: ['yIN'] },
		xOutKey: 'fitx',
		yOutKeyPrefix: 'fity_',
		nodeSpec: {
			id: 'tableprocess.fitfunction',
			inputs: [
				{ name: 'xIN', kind: 'column', cardinality: 'one' },
				{ name: 'yIN', kind: 'column', cardinality: 'many' }
			],
			outputs: [
				{ name: 'fitx', kind: 'column', cardinality: 'one' },
				{ name: 'fity_*', kind: 'column', cardinality: 'many', dynamicPrefix: 'fity_' },
				{ name: 'permstats_*', kind: 'column', cardinality: 'many', dynamicPrefix: 'permstats_' }
			]
		}
	};

	function getModelOptions(argsIN) {
		if (argsIN.model === 'cosinor') {
			return {
				useFixedPeriod: argsIN.useFixedPeriod ?? true,
				fixedPeriod: argsIN.fixedPeriod ?? 24,
				nHarmonics: argsIN.nHarmonics ?? 1,
				Ncurves: argsIN.Ncurves ?? 1,
				alpha: argsIN.alpha ?? 0.05
			};
		}
		if (argsIN.model === 'rectangular') {
			return {
				fixKappa: argsIN.fixKappa ?? false,
				fixedKappa: argsIN.fixedKappa ?? 5,
				fixOmega: argsIN.fixOmega ?? false,
				fixedPeriod: argsIN.fixedPeriod ?? 24,
				fixDutyCycle: argsIN.fixDutyCycle ?? false,
				fixedDutyCycle: argsIN.fixedDutyCycle ?? 0.5
			};
		}
		if (argsIN.model === 'doublelogistic') {
			return {
				periodic: argsIN.periodic ?? true,
				fixK1: argsIN.fixK1 ?? false,
				fixedK1: argsIN.fixedK1 ?? 0.5,
				fixK2: argsIN.fixK2 ?? false,
				fixedK2: argsIN.fixedK2 ?? 0.5,
				fixPeriod: argsIN.fixPeriod ?? false,
				fixedPeriod: argsIN.fixedPeriod ?? 24
			};
		}
		return {};
	}

	function getXDataForColumn(col) {
		return col.type === 'time' ? col.hoursSinceStart : col.getData();
	}

	function getValidPairs(t, y) {
		const validIndices = t
			.map((v, i) => (isNaN(v) || isNaN(y[i]) ? -1 : i))
			.filter((i) => i !== -1);
		return {
			tt: validIndices.map((i) => t[i]),
			yy: validIndices.map((i) => y[i])
		};
	}

	function computeSingleFit(tt, yy, argsIN) {
		return fitCurveModel(tt, yy, argsIN.model ?? 'cosinor', getModelOptions(argsIN));
	}

	function evaluateForOutput(fitResult, argsIN, outputXData) {
		if (!outputXData) return null;
		return evaluateCurveModelAtPoints(fitResult, argsIN.model ?? 'cosinor', outputXData);
	}

	function buildYResult(tt, yy, argsIN, outputXData) {
		const fitResult = computeSingleFit(tt, yy, argsIN);
		if (!fitResult) return null;
		const predicted = evaluateForOutput(fitResult, argsIN, outputXData);
		return {
			fitResult,
			predicted,
			t: tt,
			xOutData: outputXData ?? tt,
			yOutData: predicted ?? fitResult.fitted
		};
	}

	function buildFitResult(argsIN) {
		const xIN = argsIN.xIN;
		let yINs = argsIN.yIN;
		if (!Array.isArray(yINs)) yINs = yINs != null && yINs !== -1 ? [yINs] : [];
		const outputXId = argsIN.outputX;
		const xOUT = argsIN.out?.fitx;

		let result = {
			t: [],
			outputXData: null,
			y_results: {},
			originTime_ms: null
		};
		let anyValid = false;

		if (xIN == -1 || !getColumnById(xIN) || yINs.length === 0) return [result, false];

		const tCol = getColumnById(xIN);
		const t = getXDataForColumn(tCol);

		let outputXData = null;
		if (outputXId != -1 && getColumnById(outputXId)) {
			const outputXCol = getColumnById(outputXId);
			outputXData = getXDataForColumn(outputXCol).filter((v) => !isNaN(v));
		}
		result.outputXData = outputXData;

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
			const { tt, yy } = getValidPairs(t, y);
			if (tt.length === 0) continue;

			const yResult = buildYResult(tt, yy, argsIN, outputXData);
			if (!yResult) continue;

			result.y_results[yId] = yResult;
			if (result.t.length === 0) result.t = tt;
			if (yResult.fitResult?.fitted?.length > 0) anyValid = true;
		}

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

		if (anyValid && xOUT !== -1) {
			const processHash = crypto.randomUUID();
			const firstYId = Object.keys(result.y_results)[0];
			const firstYResult = result.y_results[firstYId];
			const xOutData = firstYResult.xOutData ?? outputXData ?? firstYResult.t;
			const xOutMs =
				originTime_ms != null ? xOutData.map((h) => originTime_ms + h * 3600000) : xOutData;
			const xColOut = getColumnById(xOUT);
			if (xColOut) {
				core.rawData.set(xOUT, xOutMs);
				xColOut.data = xOUT;
				xColOut.type = originTime_ms != null ? 'time' : 'number';
				if (originTime_ms != null) xColOut.timeFormat = null;
				xColOut.tableProcessGUId = processHash;
			}

			for (const yId of yINs) {
				const outKey = 'fity_' + yId;
				const yOUT = argsIN.out?.[outKey];
				const yResult = result.y_results[yId];
				if (yOUT != null && yOUT !== -1 && yResult) {
					const yColOut = getColumnById(yOUT);
					if (yColOut) {
						core.rawData.set(yOUT, yResult.yOutData);
						yColOut.data = yOUT;
						yColOut.type = 'number';
						yColOut.tableProcessGUId = processHash;
					}
				}
			}
		}

		return [result, anyValid];
	}

	export function fitFunction(argsIN) {
		return buildFitResult(argsIN);
	}
</script>

<script>
	// @ts-nocheck
	import { tick } from 'svelte';
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';
	import ColumnComponent from '$lib/core/Column.svelte';
	import Table from '$lib/components/plotbits/Table.svelte';
	import StoreValueButton from '$lib/components/inputs/StoreValueButton.svelte';
	import AttributeSelect from '$lib/components/inputs/AttributeSelect.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import LoadingSpinner from '$lib/components/LoadingSpinner.svelte';

	import { Column, getColumnById } from '$lib/core/Column.svelte';
	import { pushObj } from '$lib/core/core.svelte.js';
	import { useMultiYTP } from '$lib/tableProcesses/useMultiYTP.svelte.js';
	import { onMount, untrack } from 'svelte';
	import {
		showStaticDataAsTable,
		saveStaticDataAsCSV
	} from '$lib/components/plotbits/helpers/save.svelte.js';
	import { recommendPermutations, permutationTestAsync } from '$lib/utils/permutationTest.js';

	let { p = $bindable(), hideInputs = false } = $props();

	if (typeof p.args.yIN === 'number') {
		p.args.yIN = p.args.yIN !== -1 ? [p.args.yIN] : [];
	}
	if (typeof p.args.out !== 'object' || p.args.out === null) {
		p.args.out = { fitx: -1 };
	}
	if (p.args.model === undefined) p.args.model = 'cosinor';
	if (p.args.useFixedPeriod === undefined) p.args.useFixedPeriod = true;
	if (p.args.fixedPeriod === undefined) p.args.fixedPeriod = 24;
	if (p.args.Ncurves === undefined) p.args.Ncurves = 1;
	if (p.args.nHarmonics === undefined) p.args.nHarmonics = 1;
	if (p.args.alpha === undefined) p.args.alpha = 0.05;
	if (p.args.fixKappa === undefined) p.args.fixKappa = false;
	if (p.args.fixedKappa === undefined) p.args.fixedKappa = 5;
	if (p.args.fixOmega === undefined) p.args.fixOmega = false;
	if (p.args.fixDutyCycle === undefined) p.args.fixDutyCycle = false;
	if (p.args.fixedDutyCycle === undefined) p.args.fixedDutyCycle = 0.5;
	if (p.args.periodic === undefined) p.args.periodic = true;
	if (p.args.fixK1 === undefined) p.args.fixK1 = false;
	if (p.args.fixedK1 === undefined) p.args.fixedK1 = 0.5;
	if (p.args.fixK2 === undefined) p.args.fixK2 = false;
	if (p.args.fixedK2 === undefined) p.args.fixedK2 = 0.5;
	if (p.args.permuteTest === undefined) p.args.permuteTest = false;
	if (p.args.autoPermutations === undefined) p.args.autoPermutations = false;
	if (p.args.nPermutations === undefined) p.args.nPermutations = 999;
	if (p.args.permutationSeed === undefined) p.args.permutationSeed = 12345;
	if (p.args.permutationStatistic === undefined) p.args.permutationStatistic = 'rSquared';

	let fitData = $state();
	let showOutputX = $state(p.args.outputX !== -1);
	let mounted = $state(false);
	let previewStart = $state(1);
	let calculating = $state(false);
	let permutationProgress = $state(0);
	let permutationLabel = $state('');
	let _calcToken = 0;

	const { syncYColumns, initYColumns } = useMultiYTP(p, 'fity_', 'fit_');
	const { syncYColumns: syncPermColumns, initYColumns: initPermColumns } = useMultiYTP(
		p,
		'permstats_',
		'permstats_'
	);

	let xIN_col = $derived.by(() => (p.args.xIN >= 0 ? getColumnById(p.args.xIN) : null));
	let outputX_col = $derived.by(() => (p.args.outputX >= 0 ? getColumnById(p.args.outputX) : null));
	let getHash = $derived.by(() => {
		let out = '';
		out += xIN_col?.getDataHash ?? '';
		for (const yId of p.args.yIN ?? []) {
			const col = yId >= 0 ? getColumnById(yId) : null;
			out += col?.getDataHash ?? '';
		}
		out += outputX_col?.getDataHash ?? '';
		out += p.args.model;
		out += p.args.useFixedPeriod;
		out += p.args.fixedPeriod;
		out += p.args.Ncurves;
		out += p.args.nHarmonics;
		out += p.args.fixKappa;
		out += p.args.fixOmega;
		out += p.args.fixDutyCycle;
		out += p.args.periodic;
		out += p.args.fixK1;
		out += p.args.fixK2;
		out += p.args.permuteTest;
		out += p.args.autoPermutations;
		out += p.args.nPermutations;
		out += p.args.permutationSeed;
		out += p.args.permutationStatistic;
		return out;
	});
	// Persisted in p.args so reopening the control panel (which remounts this
	// component) doesn't reset it to '' and trigger a needless recompute. The
	// fit only re-runs when getHash actually differs (an input or arg changed).
	let lastHash = p.args._fitHash ?? '';

	function onYSelectionChange() {
		const fitColsChanged = syncYColumns();
		const permColsChanged = syncPermColumns();
		if (fitColsChanged || permColsChanged) getFit();
	}

	function getModelArgs() {
		return {
			model: p.args.model,
			useFixedPeriod: p.args.useFixedPeriod,
			fixedPeriod: p.args.fixedPeriod,
			Ncurves: p.args.Ncurves,
			nHarmonics: p.args.nHarmonics,
			alpha: p.args.alpha,
			fixKappa: p.args.fixKappa,
			fixedKappa: p.args.fixedKappa,
			fixOmega: p.args.fixOmega,
			fixedOmega: p.args.fixedOmega,
			fixDutyCycle: p.args.fixDutyCycle,
			fixedDutyCycle: p.args.fixedDutyCycle,
			periodic: p.args.periodic,
			fixK1: p.args.fixK1,
			fixedK1: p.args.fixedK1,
			fixK2: p.args.fixK2,
			fixedK2: p.args.fixedK2
		};
	}

	function getXData(col) {
		return col.type === 'time' ? col.hoursSinceStart : col.getData();
	}

	function getValidPairs(t, y) {
		const validIndices = t
			.map((v, i) => (isNaN(v) || isNaN(y[i]) ? -1 : i))
			.filter((i) => i !== -1);
		return {
			tt: validIndices.map((i) => t[i]),
			yy: validIndices.map((i) => y[i])
		};
	}

	async function getFit() {
		previewStart = 1;
		const token = ++_calcToken;
		calculating = true;
		permutationProgress = 0;
		permutationLabel = '';
		await tick();

		const xIN = p.args.xIN;
		let yINs = p.args.yIN;
		if (!Array.isArray(yINs)) yINs = yINs != null && yINs !== -1 ? [yINs] : [];
		const xCol = xIN >= 0 ? getColumnById(xIN) : null;
		if (!xCol || yINs.length === 0) {
			if (token === _calcToken) calculating = false;
			return;
		}

		const t = getXData(xCol);
		const outputXId = p.args.outputX;
		let outputXData = null;
		if (outputXId != -1 && getColumnById(outputXId)) {
			const outputXCol = getColumnById(outputXId);
			outputXData = getXData(outputXCol).filter((v) => !isNaN(v));
		}

		let originTime_ms = null;
		if (outputXId != -1) {
			const outputXColForOrigin = getColumnById(outputXId);
			if (outputXColForOrigin?.type === 'time') {
				originTime_ms = outputXColForOrigin.getData()[0];
			}
		}
		if (originTime_ms == null && xCol.type === 'time') {
			originTime_ms = xCol.getData()[0];
		}

		const result = {
			t: [],
			outputXData,
			originTime_ms,
			y_results: {}
		};

		const activeY = [];
		for (const yId of yINs) {
			const yCol = getColumnById(yId);
			if (!yCol) continue;
			const y = yCol.getData();
			const { tt, yy } = getValidPairs(t, y);
			if (tt.length === 0) continue;
			activeY.push({ yId, tt, yy });
		}

		if (activeY.length === 0) {
			if (token === _calcToken) calculating = false;
			return;
		}

		let anyValid = false;
		for (let index = 0; index < activeY.length; index++) {
			const { yId, tt, yy } = activeY[index];
			if (token !== _calcToken) return;

			let yResult = buildYResult(tt, yy, p.args, outputXData);
			if (!yResult) continue;

			if (p.args.permuteTest) {
				const nPermutations = p.args.autoPermutations
					? recommendPermutations(tt.length)
					: p.args.nPermutations;
				const permResult = await permutationTestAsync(
					tt,
					yy,
					(xVals, yVals) => computeSingleFit(xVals, yVals, p.args),
					{
						statistic: p.args.permutationStatistic ?? 'rSquared',
						nPermutations,
						seed: p.args.permutationSeed,
						onProgress: (current, total) => {
							if (token !== _calcToken) return;
							const progress = (index + current / total) / activeY.length;
							permutationProgress = Math.max(0, Math.min(100, Math.round(progress * 100)));
							permutationLabel = `${index + 1} / ${activeY.length}`;
						}
					}
				);
				yResult.fitResult.pValue = permResult.pValue;
				yResult.fitResult.significant = permResult.significant;
				yResult.fitResult.permutedStats = permResult.permutedStats;
				yResult.fitResult.permutationSeed = permResult.seed;
				yResult.fitResult.permutationN = permResult.nPermutations;
			}

			result.y_results[yId] = yResult;
			if (result.t.length === 0) result.t = tt;
			if (yResult.fitResult?.fitted?.length > 0) anyValid = true;
		}

		for (const pp of p.args.preProcesses ?? []) {
			if (!pp.processName) continue;
			const proc = appConsts.processMap.get(pp.processName);
			if (proc?.func) {
				for (const yId of Object.keys(result.y_results)) {
					result.y_results[yId].yOutData = proc.func(
						result.y_results[yId].yOutData,
						pp.processArgs ?? {}
					);
				}
			}
		}

		if (token !== _calcToken) return;
		fitData = result;
		p.args.valid = anyValid;
		if (anyValid && p.args.out?.fitx !== -1) {
			const processHash = crypto.randomUUID();
			const firstYId = Object.keys(result.y_results)[0];
			const firstYResult = result.y_results[firstYId];
			const xOutData = firstYResult.xOutData ?? outputXData ?? firstYResult.t;
			const xOutMs =
				originTime_ms != null ? xOutData.map((h) => originTime_ms + h * 3600000) : xOutData;
			const xColOut = getColumnById(p.args.out.fitx);
			if (xColOut) {
				core.rawData.set(p.args.out.fitx, xOutMs);
				xColOut.data = p.args.out.fitx;
				xColOut.type = originTime_ms != null ? 'time' : 'number';
				if (originTime_ms != null) xColOut.timeFormat = null;
				xColOut.tableProcessGUId = processHash;
			}

			for (const yId of yINs) {
				const outKey = 'fity_' + yId;
				const yOUT = p.args.out[outKey];
				const yResult = result.y_results[yId];
				if (yOUT != null && yOUT !== -1 && yResult) {
					const yColOut = getColumnById(yOUT);
					if (yColOut) {
						core.rawData.set(yOUT, yResult.yOutData);
						yColOut.data = yOUT;
						yColOut.type = 'number';
						yColOut.tableProcessGUId = processHash;
					}
				}

				const permOutId = p.args.out['permstats_' + yId];
				if (permOutId != null && permOutId !== -1) {
					const permColOut = getColumnById(permOutId);
					if (permColOut) {
						core.rawData.set(
							permOutId,
							Array.isArray(yResult?.fitResult?.permutedStats)
								? yResult.fitResult.permutedStats
								: []
						);
						permColOut.data = permOutId;
						permColOut.type = 'number';
						permColOut.tableProcessGUId = processHash;
					}
				}
			}
		}

		if (!p.args.permuteTest) {
			for (const yId of yINs) {
				const permOutId = p.args.out['permstats_' + yId];
				if (permOutId != null && permOutId !== -1) {
					const permColOut = getColumnById(permOutId);
					if (permColOut) {
						core.rawData.set(permOutId, []);
						permColOut.data = permOutId;
						permColOut.type = 'number';
					}
				}
			}
		}

		if (token === _calcToken) calculating = false;
		lastHash = getHash;
		p.args._fitHash = lastHash;
	}

	let yExcludeIds = $derived.by(() => {
		if (hideInputs) return [];
		const ids = [p.args.xIN];
		if (p.args.out.fitx >= 0) ids.push(p.args.out.fitx);
		for (const key of Object.keys(p.args.out)) {
			if ((key.startsWith('fity_') || key.startsWith('permstats_')) && p.args.out[key] >= 0)
				ids.push(p.args.out[key]);
		}
		return ids;
	});

	$effect(() => {
		const dataHash = getHash;
		if (!mounted) return;
		if (lastHash !== dataHash && !calculating) {
			// Mark this hash as handled BEFORE the async getFit runs so the
			// effect can't re-enter while getFit is suspended on `await tick()`.
			// Mirrors the Cosinor pattern; getFit's bail-out paths leave lastHash
			// alone, so without this guard a no-op getFit can be called repeatedly
			// (xIN=-1, yIN=[]) and never settle the hash.
			lastHash = dataHash;
			untrack(() => {
				getFit();
			});
		}
	});

	$effect(() => {
		const _yIN = p.args.yIN;
		if (!mounted) return;
		untrack(() => {
			if (syncYColumns()) getFit();
		});
	});

	onMount(() => {
		if (!p.args.out) p.args.out = {};
		if ((p.args.out.fitx == null || p.args.out.fitx < 0) && p.parent) {
			const xCol = new Column({});
			xCol.name = 'fitx_' + p.id;
			pushObj(xCol);
			p.parent.columnRefs = [xCol.id, ...p.parent.columnRefs];
			p.args.out.fitx = xCol.id;
		}
		const needsCompute = initYColumns() || initPermColumns();
		if (needsCompute) {
			getFit();
		} else {
			const xKey = p.args.out.fitx;
			if (xKey >= 0 && core.rawData.has(xKey) && core.rawData.get(xKey).length > 0) {
				const y_results = {};
				for (const yId of p.args.yIN ?? []) {
					const outKey = 'fity_' + yId;
					const yOutId = p.args.out[outKey];
					if (yOutId >= 0 && core.rawData.has(yOutId)) {
						y_results[yId] = {
							fitResult: {
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
				fitData = {
					t: core.rawData.get(xKey),
					outputXData: null,
					y_results,
					originTime_ms: null
				};
				p.args.valid = true;
				const inputsAreStale =
					(p.args.xIN >= 0 && (getColumnById(p.args.xIN)?.rawDataVersion ?? 0) > 0) ||
					(p.args.yIN ?? []).some((id) => (getColumnById(id)?.rawDataVersion ?? 0) > 0);
				if (!inputsAreStale) {
						lastHash = getHash;
						p.args._fitHash = lastHash;
					}
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

	function getFitStatsData() {
		if (!fitData?.y_results) return { headers: [], rows: [] };
		const model = p.args.model ?? 'cosinor';
		const validEntries = Object.entries(fitData.y_results).filter(
			([, r]) => (r.fitResult?.fitted?.length ?? 0) > 0
		);
		if (!validEntries.length) return { headers: [], rows: [] };
		const includePermutation = validEntries.some(
			([, r]) =>
				Number.isFinite(r.fitResult?.pValue) || typeof r.fitResult?.significant === 'boolean'
		);

		let headers = ['column', 'rmse', 'r2'];
		if (model === 'cosinor') {
			if (p.args.useFixedPeriod) {
				headers.push('M', 'period', 'pValue');
				const maxH = Math.max(
					...validEntries.map(([, r]) => r.fitResult?.fixedStats?.harmonics?.length ?? 0)
				);
				for (let i = 0; i < maxH; i++) headers.push(`H${i + 1}_amplitude`, `H${i + 1}_acrophase`);
			} else {
				const maxC = Math.max(
					...validEntries.map(([, r]) => r.fitResult?.parameters?.cosines?.length ?? 0)
				);
				for (let i = 0; i < maxC; i++)
					headers.push(`C${i + 1}_period`, `C${i + 1}_amplitude`, `C${i + 1}_phase`);
			}
		} else if (model === 'rectangular') {
			headers.push('period', 'acrophase', 'duty_cycle', 'kappa', 'M', 'A', 'pValue');
		} else if (model === 'doublelogistic') {
			headers.push('onset', 'offset', 'k1', 'k2', 'period', 'duty_cycle', 'M', 'A', 'pValue');
		}

		if (includePermutation) headers.push('significant');

		const rows = validEntries.map(([yId, r]) => {
			const name = getColumnById(Number(yId))?.name ?? String(yId);
			const fr = r.fitResult;
			const row = [name, fr.rmse, fr.rSquared];
			if (model === 'cosinor') {
				if (p.args.useFixedPeriod) {
					row.push(
						fr.fixedStats?.M ?? fr.parameters?.M ?? null,
						fr.parameters?.period ?? null,
						fr.pValue ?? null
					);
					for (const h of fr.fixedStats?.harmonics ?? []) {
						row.push(h.amplitude ?? null, h.acrophase_hrs ?? null);
					}
					while (row.length < headers.length) row.push(null);
				} else {
					for (const c of fr.parameters?.cosines ?? []) {
						const period = c.frequency ? (2 * Math.PI) / c.frequency : NaN;
						row.push(period, c.amplitude ?? null, c.phase ?? null);
					}
					while (row.length < headers.length) row.push(null);
				}
			} else if (model === 'rectangular') {
				row.push(
					fr.period ?? null,
					fr.acrophase ?? null,
					fr.parameters?.dutyCycle ?? null,
					fr.parameters?.kappa ?? null,
					fr.parameters?.M ?? null,
					fr.parameters?.A ?? null,
					fr.pValue ?? null
				);
			} else if (model === 'doublelogistic') {
				row.push(
					fr.onsetPhase ?? fr.parameters?.t1 ?? null,
					fr.offsetPhase ?? fr.parameters?.t2 ?? null,
					fr.parameters?.k1 ?? null,
					fr.parameters?.k2 ?? null,
					fr.parameters?.T ?? null,
					fr.dutyCycle ?? null,
					fr.parameters?.M ?? null,
					fr.parameters?.A ?? null,
					fr.pValue ?? null
				);
			}
			if (includePermutation) {
				row.push(typeof fr.significant === 'boolean' ? fr.significant : null);
			}
			return row;
		});

		return { headers, rows };
	}
</script>

{#if !hideInputs}
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

<div class="section-row">
	<div class="tableProcess-label">
		<span>Fit parameters</span>
	</div>

	<div class="control-input-horizontal">
		<div class="control-input">
			<p>Model</p>
			<AttributeSelect
				bind:value={p.args.model}
				options={['cosinor', 'rectangular', 'doublelogistic']}
				optionsDisplay={['Cosinor', 'Rectangular wave', 'Double logistic']}
				onChange={() => getFit()}
			/>
		</div>
	</div>

	{#if p.args.model === 'cosinor'}
		<div class="control-input-horizontal">
			<div class="control-input">
				<label>
					<input type="checkbox" bind:checked={p.args.useFixedPeriod} onchange={() => getFit()} />
					Use fixed period / harmonic model
				</label>
			</div>
		</div>
		{#if p.args.useFixedPeriod}
			<div class="control-input-horizontal">
				<div class="control-input">
					<p>Fixed period</p>
					<NumberWithUnits
						bind:value={p.args.fixedPeriod}
						min="0.1"
						step="0.1"
						onInput={() => getFit()}
					/>
				</div>
				<div class="control-input">
					<p>Harmonics</p>
					<NumberWithUnits
						bind:value={p.args.nHarmonics}
						min="1"
						step="1"
						onInput={() => getFit()}
					/>
				</div>
				<div class="control-input">
					<p>Alpha</p>
					<NumberWithUnits
						bind:value={p.args.alpha}
						min="0.001"
						max="0.2"
						step="0.005"
						onInput={() => getFit()}
					/>
				</div>
			</div>
		{:else}
			<div class="control-input-horizontal">
				<div class="control-input">
					<p>Number of cosines</p>
					<NumberWithUnits bind:value={p.args.Ncurves} min="1" step="1" onInput={() => getFit()} />
				</div>
			</div>
		{/if}
	{:else if p.args.model === 'rectangular'}
		<div class="control-input-horizontal">
			<div class="control-input">
				<label
					><input type="checkbox" bind:checked={p.args.fixKappa} onchange={() => getFit()} /> Fix sharpness
					(κ)</label
				>
			</div>
			<div class="control-input">
				<label
					><input type="checkbox" bind:checked={p.args.fixOmega} onchange={() => getFit()} /> Fix period</label
				>
			</div>
			<div class="control-input">
				<label
					><input type="checkbox" bind:checked={p.args.fixDutyCycle} onchange={() => getFit()} /> Fix
					duty cycle</label
				>
			</div>
		</div>
		{#if p.args.fixKappa}
			<div class="control-input-horizontal">
				<div class="control-input">
					<p>κ value</p>
					<NumberWithUnits
						bind:value={p.args.fixedKappa}
						min="0.1"
						step="0.5"
						onInput={() => getFit()}
					/>
				</div>
			</div>
		{/if}
		{#if p.args.fixOmega}
			<div class="control-input-horizontal">
				<div class="control-input">
					<p>Period</p>
					<NumberWithUnits
						bind:value={p.args.fixedPeriod}
						min="0.1"
						step="0.1"
						onInput={() => getFit()}
					/>
				</div>
			</div>
		{/if}
		{#if p.args.fixDutyCycle}
			<div class="control-input-horizontal">
				<div class="control-input">
					<p>Duty cycle</p>
					<NumberWithUnits
						bind:value={p.args.fixedDutyCycle}
						min="0.01"
						max="0.99"
						step="0.05"
						onInput={() => getFit()}
					/>
				</div>
			</div>
		{/if}
	{:else if p.args.model === 'doublelogistic'}
		<div class="control-input-horizontal">
			<div class="control-input">
				<label
					><input type="checkbox" bind:checked={p.args.periodic} onchange={() => getFit()} /> Periodic
					mode</label
				>
			</div>
			<div class="control-input">
				<label
					><input type="checkbox" bind:checked={p.args.fixK1} onchange={() => getFit()} /> Fix k1</label
				>
			</div>
			<div class="control-input">
				<label
					><input type="checkbox" bind:checked={p.args.fixK2} onchange={() => getFit()} /> Fix k2</label
				>
			</div>
			<div class="control-input">
				<label
					><input type="checkbox" bind:checked={p.args.fixPeriod} onchange={() => getFit()} /> Fix period</label
				>
			</div>
		</div>
		{#if p.args.fixK1}
			<div class="control-input-horizontal">
				<div class="control-input">
					<p>k1</p>
					<NumberWithUnits
						bind:value={p.args.fixedK1}
						min="0.01"
						step="0.1"
						onInput={() => getFit()}
					/>
				</div>
			</div>
		{/if}
		{#if p.args.fixK2}
			<div class="control-input-horizontal">
				<div class="control-input">
					<p>k2</p>
					<NumberWithUnits
						bind:value={p.args.fixedK2}
						min="0.01"
						step="0.1"
						onInput={() => getFit()}
					/>
				</div>
			</div>
		{/if}
		{#if p.args.fixPeriod}
			<div class="control-input-horizontal">
				<div class="control-input">
					<p>Period</p>
					<NumberWithUnits
						bind:value={p.args.fixedPeriod}
						min="0.1"
						step="0.1"
						onInput={() => getFit()}
					/>
				</div>
			</div>
		{/if}
	{/if}

	<div class="control-input-horizontal">
		<div class="control-input">
			<label>
				<input type="checkbox" bind:checked={p.args.permuteTest} onchange={() => getFit()} />
				Permutation test for significance
			</label>
		</div>
	</div>

	{#if p.args.permuteTest}
		<div
			class="control-input-vertical"
			style="background-color: var(--color-lightness-95); padding: 10px; border-radius: var(--radius-sm); margin: 10px 0;"
		>
			<div class="control-input">
				<label>
					<input
						type="checkbox"
						bind:checked={p.args.autoPermutations}
						disabled={calculating}
						onchange={() => getFit()}
					/>
					Auto permutations based on data size
				</label>
			</div>
			{#if !p.args.autoPermutations}
				<div class="control-input">
					<p>Permutations</p>
					<NumberWithUnits
						bind:value={p.args.nPermutations}
						min="99"
						max="9999"
						step="100"
						disabled={calculating}
						onInput={() => getFit()}
					/>
				</div>
			{/if}
			<div class="control-input">
				<p>Seed</p>
				<NumberWithUnits
					bind:value={p.args.permutationSeed}
					min="1"
					max="2147483646"
					step="1"
					disabled={calculating}
					onInput={() => getFit()}
				/>
			</div>
			<div class="control-input">
				<p>Statistic</p>
				<AttributeSelect
					bind:value={p.args.permutationStatistic}
					options={['rSquared', 'rmse']}
					optionsDisplay={['R²', 'RMSE']}
					onChange={() => getFit()}
				/>
			</div>
			<button onclick={() => getFit()} disabled={calculating} style="margin-top: 10px;">
				{#if calculating}
					Testing... {permutationProgress}%
				{:else}
					Run permutation test
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

{#snippet fitStats(yResult, yName)}
	<div class="control-input-horizontal">
		<div class="control-input">
			<p>
				R²: {yResult?.fitResult?.rSquared?.toFixed(3)}
				<StoreValueButton
					label="R²"
					getter={() => yResult?.fitResult?.rSquared}
					defaultName={`fit_r2_${yName}`}
					source={'Fit Function (' + p.args.model + ')'}
				/>
				&ensp;RMSE: {yResult?.fitResult?.rmse?.toFixed(3)}
				<StoreValueButton
					label="RMSE"
					getter={() => yResult?.fitResult?.rmse}
					defaultName={`fit_rmse_${yName}`}
					source={'Fit Function (' + p.args.model + ')'}
				/>
			</p>
			{#if Array.isArray(yResult?.fitResult?.permutedStats) && yResult.fitResult.permutedStats.length > 0 && Number.isFinite(yResult?.fitResult?.pValue)}
				<p
					style="color: {yResult.fitResult.significant ? '#10b981' : '#f59e0b'}; font-weight: bold;"
				>
					Perm p-value: {yResult.fitResult.pValue.toFixed(4)}
					{#if yResult.fitResult.significant}
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
			{#if p.args.model === 'cosinor'}
				{#if p.args.useFixedPeriod}
					<p>Mesor: {yResult?.fitResult?.fixedStats?.M?.toFixed(3)}</p>
					<p>Period: {p.args.fixedPeriod?.toFixed?.(3)} hrs</p>
					{#each yResult?.fitResult?.fixedStats?.harmonics ?? [] as h, i}
						<p>
							H{i + 1}: amp {h.amplitude?.toFixed(3)}, phase {h.acrophase_hrs?.toFixed(3)} hrs
							<StoreValueButton
								label={`H${i + 1}`}
								getter={() => h.amplitude}
								defaultName={`fit_h${i + 1}_${yName}`}
								source="Fit Function (cosinor)"
							/>
						</p>
					{/each}
				{:else}
					{#each yResult?.fitResult?.parameters?.cosines ?? [] as c, i}
						<p>
							C{i + 1}: amp {c.amplitude?.toFixed(3)}, period {c.frequency
								? ((2 * Math.PI) / c.frequency).toFixed(3)
								: 'NaN'}
							<StoreValueButton
								label={`C${i + 1}`}
								getter={() => c.amplitude}
								defaultName={`fit_c${i + 1}_${yName}`}
								source="Fit Function (cosinor)"
							/>
						</p>
					{/each}
				{/if}
			{:else if p.args.model === 'rectangular'}
				<p>Mesor: {yResult?.fitResult?.parameters?.M?.toFixed(3)}</p>
				<p>Amplitude: {yResult?.fitResult?.parameters?.A?.toFixed(3)}</p>
				<p>Period: {yResult?.fitResult?.period?.toFixed(3)} hrs</p>
				<p>Acrophase: {yResult?.fitResult?.acrophase?.toFixed(3)} hrs</p>
				<p>Duty cycle: {(yResult?.fitResult?.parameters?.dutyCycle * 100)?.toFixed?.(1)}%</p>
				<p>κ: {yResult?.fitResult?.parameters?.kappa?.toFixed(3)}</p>
			{:else if p.args.model === 'doublelogistic'}
				<p>Mesor: {yResult?.fitResult?.parameters?.M?.toFixed(3)}</p>
				<p>Amplitude: {yResult?.fitResult?.parameters?.A?.toFixed(3)}</p>
				<p>Onset: {yResult?.fitResult?.onsetPhase?.toFixed(3)} hrs</p>
				<p>Offset: {yResult?.fitResult?.offsetPhase?.toFixed(3)} hrs</p>
				<p>k1: {yResult?.fitResult?.parameters?.k1?.toFixed(3)}</p>
				<p>k2: {yResult?.fitResult?.parameters?.k2?.toFixed(3)}</p>
				{#if yResult?.fitResult?.parameters?.T != null}
					<p>Period: {yResult.fitResult.parameters.T.toFixed(3)} hrs</p>
				{/if}
			{/if}
		</div>
	</div>
{/snippet}

<details open>
	<summary class="section-details-summary">Output</summary>
	<div class="section-row">
		<div class="section-content">
			{#if calculating}
				<LoadingSpinner
					message="Fitting model"
					detail={p.args.permuteTest
						? `${permutationProgress}% complete${permutationLabel ? `, ${permutationLabel}` : ''}`
						: ''}
				/>
			{:else if p.args.valid && p.args.out.fitx != -1}
				{@const xout = getColumnById(p.args.out.fitx)}
				<div class="tp-outputs">
					<div class="tp-output-row">
						<span class="tp-output-label">{getColumnById(p.args.xIN)?.name ?? 'x'} (shared)</span>
						<ColumnComponent col={xout} />
					</div>
					{#each p.args.yIN ?? [] as yId}
						{@const outKey = 'fity_' + yId}
						{@const yOutId = p.args.out[outKey]}
						{#if yOutId >= 0}
							{@const yout = getColumnById(yOutId)}
							{#if yout}
								{@const yResult = fitData?.y_results?.[yId]}
								{@const srcName = getColumnById(Number(yId))?.name ?? yId}
								{@const permOutKey = 'permstats_' + yId}
								{@const permOutId = p.args.out[permOutKey]}
								{@const permOut = permOutId >= 0 ? getColumnById(permOutId) : null}
								<div class="tp-output-row">
									<span class="tp-output-label">{srcName}</span>
									<ColumnComponent col={yout} />
									{#if yResult}
										{@render fitStats(yResult, srcName)}
									{/if}
								</div>
								{#if permOut}
									<div class="tp-output-row">
										<span class="tp-output-label">Permutation stats ({srcName})</span>
										<ColumnComponent col={permOut} />
									</div>
								{/if}
							{/if}
						{/if}
					{/each}
				</div>
			{:else if p.args.valid}
				<p>Preview:</p>
				{#each Object.entries(fitData?.y_results ?? {}) as [yId, yResult]}
					{@const srcName = getColumnById(Number(yId))?.name ?? yId}
					<div class="div-line"></div>
					<p><strong>{srcName}</strong></p>
					{@render fitStats(yResult, srcName)}
				{/each}
				{@const xData = fitData.outputXData ?? fitData.t}
				{@const yIds = Object.keys(fitData?.y_results ?? {})}
				{@const totalRows = xData.length}
				<Table
					headers={[
						'x',
						...yIds.map(
							(id) =>
								(fitData.outputXData ? 'predicted ' : 'fitted ') +
								(getColumnById(Number(id))?.name ?? id)
						)
					]}
					data={[
						xData.slice(previewStart - 1, previewStart + 5).map((x) => x.toFixed(2)),
						...yIds.map((id) => {
							const yr = fitData.y_results[id];
							const yData = yr.predicted ?? yr.fitResult.fitted;
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
</details>

{#if p.args.valid && p.args.out.fitx != -1}
	<div class="tp-stat-actions">
		<button
			class="tp-stat-btn"
			onclick={() => {
				const { headers, rows } = getFitStatsData();
				showStaticDataAsTable('Fit function stats', headers, rows, getFitStatsData);
			}}>View stats</button
		>
		<button
			class="tp-stat-btn"
			onclick={() => {
				const { headers, rows } = getFitStatsData();
				saveStaticDataAsCSV('fit_function_stats', headers, rows);
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
		border: 1px solid var(--color-lightness-75, #aaa);
		border-radius: 3px;
		background: none;
		cursor: pointer;
		color: var(--color-lightness-35, #555);
	}

	.tp-stat-btn:hover {
		background: var(--color-lightness-95);
		border-color: var(--color-lightness-55, #888);
	}
</style>
