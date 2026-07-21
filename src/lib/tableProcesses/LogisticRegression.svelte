<script module>
	// @ts-nocheck
	// Logistic regression — model a binary outcome from one or more predictors.
	//
	// yIN is the binary outcome (numeric 0/1, or a two-level category — the second level, sorted,
	// is taken as the "positive" class = 1). xIN is one or more predictor columns. Fitted by IRLS
	// (utils/logistic.js, statsmodels-parity-checked), reporting per term: coefficient, SE, Wald z,
	// p-value, odds ratio and its 95% CI, plus the model log-likelihood, likelihood-ratio test and
	// McFadden pseudo-R². Output is one row per term (long form), so it composes with a table.
	import { getColumnById } from '$lib/core/Column.svelte';
	import { writeOutputColumn } from '$lib/tableProcesses/outputColumns.js';
	import { fillDefaults, normalizeYInputs } from '$lib/tableProcesses/tpArgHelpers.js';
	import { logisticRegression } from '$lib/utils/logistic.js';

	const displayName = 'Logistic regression';
	// Two families of outputs: one row PER TERM (the coefficient table), and one row PER OBSERVATION
	// (outcome / linear-predictor / fitted-probability), which drive the quick-plot and let the plot
	// be rebuilt by hand (fitted-vs-eta is the sigmoid; outcome-vs-eta are the observed points).
	const TERM_KEYS = ['term', 'coef', 'se', 'z', 'pvalue', 'oddsRatio', 'ciLow', 'ciHigh'];
	const OBS_KEYS = ['outcome', 'eta', 'fitted'];
	const OUT_KEYS = [...TERM_KEYS, ...OBS_KEYS];

	const defaults = new Map([
		['yIN', { val: -1 }], // binary outcome
		['xIN', { val: [] }], // predictors
		['out', { ...Object.fromEntries(OUT_KEYS.map((k) => [k, { val: -1 }])) }],
		['valid', { val: false }]
	]);

	const isRef = (id) => id != null && id !== -1 && getColumnById(id);

	/** Coerce an outcome column to 0/1. Returns {y, positiveClass, levels}. */
	function coerceBinary(raw) {
		const present = raw.filter((v) => v != null && v !== '');
		const levels = [...new Set(present.map(String))];
		// Already numeric 0/1?
		if (levels.every((l) => l === '0' || l === '1')) {
			return { y: raw.map((v) => (v == null || v === '' ? NaN : Number(v))), positiveClass: '1', levels: ['0', '1'] };
		}
		if (levels.length !== 2) return { y: raw.map(() => NaN), positiveClass: null, levels };
		const sorted = [...levels].sort();
		const positiveClass = sorted[1];
		return { y: raw.map((v) => (v == null || v === '' ? NaN : String(v) === positiveClass ? 1 : 0)), positiveClass, levels: sorted };
	}

	export function logisticregression(argsIN) {
		fillDefaults(argsIN, defaults);
		const xIds = normalizeYInputs(argsIN.xIN).filter(isRef);
		if (!isRef(argsIN.yIN) || xIds.length === 0) return [null, false];

		const outCol = getColumnById(argsIN.yIN);
		const { y, positiveClass, levels } = coerceBinary(outCol.getData() ?? []);
		const warnings = [];
		if (!positiveClass) {
			warnings.push(`The outcome "${outCol.name}" is not binary (found ${levels.length} distinct values). Logistic regression needs exactly two outcome levels.`);
			return [{ rows: [], warnings, converged: false }, true];
		}

		const predictorCols = xIds.map((id) => getColumnById(id).getData() ?? []);
		const names = xIds.map((id) => getColumnById(id).name ?? String(id));
		const fit = logisticRegression(y, predictorCols, names);

		if (!fit.coefficients.length) {
			warnings.push('Too few complete rows to fit the model (need more observations than predictors + 1).');
			return [{ rows: [], warnings, converged: false }, true];
		}
		if (!fit.converged) {
			warnings.push('The fit did not converge — often a sign of perfect or quasi-perfect separation (a predictor splits the outcome cleanly). Estimates and standard errors are unreliable.');
		}
		const rows = fit.coefficients.map((c) => ({ term: c.name, coef: c.coef, se: c.se, z: c.z, pvalue: c.pvalue, oddsRatio: c.oddsRatio, ciLow: c.ciLow, ciHigh: c.ciHigh }));

		const result = {
			rows,
			perObs: fit.perObs,
			positiveClass,
			outcomeName: outCol.name ?? String(argsIN.yIN),
			n: fit.n,
			logLik: fit.logLik,
			lrChiSq: fit.lrChiSq,
			lrDf: fit.lrDf,
			lrPvalue: fit.lrPvalue,
			pseudoR2: fit.pseudoR2,
			converged: fit.converged,
			warnings
		};
		// Write from the func so doProcess() (MCP engine + demo generator) bakes real columns.
		writeLogisticOutputs(argsIN, result);
		return [result, true];
	}

	function writeLogisticOutputs(argsIN, result) {
		if (!result?.rows?.length) return;
		const processHash = crypto.randomUUID();
		const col = (key) => result.rows.map((r) => r[key]);
		writeOutputColumn(argsIN.out?.term, col('term'), { processHash, type: 'category' });
		for (const key of TERM_KEYS.slice(1)) {
			writeOutputColumn(argsIN.out?.[key], col(key), { processHash });
		}
		// Per-observation outputs (full input length): drive the quick-plot and let it be rebuilt
		// by hand — fitted-vs-eta is the sigmoid, outcome-vs-eta the observed points.
		const perObs = result.perObs;
		if (perObs) {
			writeOutputColumn(argsIN.out?.outcome, perObs.outcome ?? [], { processHash });
			writeOutputColumn(argsIN.out?.eta, perObs.eta ?? [], { processHash });
			writeOutputColumn(argsIN.out?.fitted, perObs.fitted ?? [], { processHash });
		}
	}

	export const definition = {
		displayName,
		defaults,
		func: logisticregression,
		columnIdFields: { scalar: ['yIN'], array: ['xIN'] },
		nodeSpec: {
			id: 'tableprocess.logisticregression',
			inputs: [
				{ name: 'yIN', kind: 'column', cardinality: 'one' },
				{ name: 'xIN', kind: 'column', cardinality: 'many' }
			],
			outputs: OUT_KEYS.map((name) => ({ name, kind: 'column', cardinality: 'one' }))
		}
	};

	const fmt = (v) => (v == null || Number.isNaN(v) ? '—' : Math.abs(v) >= 1000 || (Math.abs(v) < 0.001 && v !== 0) ? Number(v).toExponential(2) : Number(v).toPrecision(4).replace(/\.?0+$/, ''));
</script>

<script>
	// @ts-nocheck
	import { onMount, untrack } from 'svelte';
	import { saveStaticDataAsCSV } from '$lib/components/plotbits/helpers/save.svelte.js';
	import { mutationService } from '$lib/core/mutationService.js';
	import { core, pushObj } from '$lib/core/core.svelte.js';
	import { Column } from '$lib/core/Column.svelte';
	let { p = $bindable() } = $props();
	let mounted = $state(false);
	let result = $state({ rows: [], warnings: [], converged: false });

	const getTableData = () => ({
		headers: OUT_KEYS,
		rows: (result.rows ?? []).map((r) => OUT_KEYS.map((k) => r[k]))
	});

	function recompute() {
		const [res, valid] = logisticregression(p.args);
		p.args.valid = valid;
		result = res ?? { rows: [], warnings: [], converged: false };
		p.warnings = result.warnings ?? [];
	}

	let getHash = $derived.by(() => {
		let h = String(p.args.yIN >= 0 ? getColumnById(p.args.yIN)?.getDataHash ?? '' : '');
		for (const id of p.args.xIN ?? []) h += ':' + (id >= 0 ? getColumnById(id)?.getDataHash ?? '' : '');
		return h;
	});
	onMount(() => {
		// Backfill any output column missing from an older saved session — the per-observation
		// outcome/eta/fitted outputs were added after this node first shipped, so old sessions lack
		// them and the quick-plot would have nothing to wire. Only for a COMMITTED node (guarding
		// against the MakeNewColumn preview, where creating columns would leak orphans). Free nodes
		// have no parent, so the column lives directly in core.data via pushObj.
		const committed = p?.id != null && (core.tableProcesses ?? []).some((tp) => tp.id === p.id);
		if (committed) {
			if (!p.args.out) p.args.out = {};
			for (const key of OUT_KEYS) {
				if (p.args.out[key] == null || p.args.out[key] < 0) {
					const col = new Column({});
					col.name = key + '_' + p.id;
					pushObj(col);
					if (p.parent && Array.isArray(p.parent.columnRefs)) p.parent.columnRefs = [col.id, ...p.parent.columnRefs];
					p.args.out[key] = col.id;
				}
			}
		}
		mounted = true;
		recompute();
	});
	let lastHash = '';
	$effect(() => {
		const hash = getHash;
		if (!mounted || hash === lastHash) return;
		lastHash = hash;
		queueMicrotask(() => untrack(() => recompute()));
	});

	function openFullTable() {
		const outIds = OUT_KEYS.map((k) => p.args.out?.[k]).filter((id) => id != null && id >= 0);
		if (!outIds.length) return;
		const pos = core.nodeLayout?.[`tableprocess_${p.id}`] ?? { x: 200, y: 200 };
		mutationService.addPlot({
			name: 'Logistic coefficients',
			type: 'tableplot',
			x: (pos.x ?? 0) + 360,
			y: pos.y ?? 0,
			width: 640,
			height: Math.min(460, 120 + (result.rows?.length ?? 0) * 26),
			plot: { columnRefs: [...outIds], showCol: outIds.map(() => true) }
		});
	}
</script>

<div class="control-input-vertical">
	{#if result.rows.length}
		<p class="hint">
			Outcome <strong>{result.outcomeName}</strong> = 1 for “{result.positiveClass}”. n = {result.n},
			pseudo-R² = {fmt(result.pseudoR2)}, model p = {fmt(result.lrPvalue)}.
		</p>
		<details class="tp-output-panel" open>
			<summary class="tp-output-summary">Coefficients</summary>
			<table class="d-table">
				<thead>
					<tr><th>term</th><th>coef</th><th>OR</th><th>p</th></tr>
				</thead>
				<tbody>
					{#each result.rows as row (row.term)}
						<tr title={`${row.term}: coef=${fmt(row.coef)} (SE ${fmt(row.se)}), OR=${fmt(row.oddsRatio)} [${fmt(row.ciLow)}, ${fmt(row.ciHigh)}], p=${fmt(row.pvalue)}`}>
							<td class="term">{row.term}</td>
							<td class="num">{fmt(row.coef)}</td>
							<td class="num">{fmt(row.oddsRatio)}</td>
							<td class="num">{fmt(row.pvalue)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
			<div class="tp-stat-actions">
				<button class="tp-stat-btn" onclick={openFullTable}>Open full table</button>
				<button
					class="tp-stat-btn"
					onclick={() => {
						const { headers, rows } = getTableData();
						saveStaticDataAsCSV('logistic_regression', headers, rows);
					}}>Download CSV</button
				>
			</div>
		</details>
	{/if}
	{#each result.warnings as w (w)}
		<p class="warn">{w}</p>
	{/each}
</div>

<style>
	.hint {
		font-size: var(--font-xs);
		color: var(--color-text-muted);
		margin: var(--space-2) 0 0;
	}
	.warn {
		font-size: var(--font-xs);
		color: var(--color-warning-text);
		background: var(--color-warning-bg);
		border-radius: var(--radius-sm);
		padding: var(--space-1) var(--space-2);
		margin: var(--space-1) 0 0;
	}
	.tp-output-panel {
		margin-top: var(--space-2);
		padding: var(--space-2);
		border: 1px solid var(--color-lightness-85);
		border-radius: var(--radius-sm);
		background: var(--color-lightness-99);
		font-size: var(--font-xs);
		line-height: 1.25;
	}
	.tp-output-panel[open] {
		max-height: 14rem;
		overflow: auto;
		scrollbar-gutter: stable;
	}
	.tp-output-summary {
		cursor: pointer;
		font-weight: 600;
		position: sticky;
		top: 0;
		background: var(--color-lightness-99);
	}
	.d-table {
		width: 100%;
		border-collapse: collapse;
		margin-top: var(--space-1);
	}
	.d-table th {
		text-align: right;
		font-weight: 600;
		color: var(--color-text-muted);
		padding: 0.1rem 0.3rem;
	}
	.d-table th:first-child {
		text-align: left;
	}
	.d-table td {
		padding: 0.1rem 0.3rem;
	}
	.d-table .term {
		text-align: left;
		white-space: nowrap;
	}
	.d-table .num {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.tp-stat-actions {
		display: flex;
		gap: var(--space-2);
		margin-top: var(--space-2);
	}
	.tp-stat-btn {
		font: inherit;
		font-size: var(--font-2xs);
		padding: var(--space-1) var(--space-2);
		border: 1px solid var(--color-lightness-85);
		border-radius: var(--radius-sm);
		background: var(--color-lightness-99);
		color: var(--color-lightness-25);
		cursor: pointer;
	}
	.tp-stat-btn:hover {
		border-color: var(--color-accent);
		background: var(--color-hover);
	}
</style>
