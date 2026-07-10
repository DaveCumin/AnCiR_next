<script module>
	import {
		normalizeYInputs,
		migrateLegacyYIN,
		fillDefaults
	} from '$lib/tableProcesses/tpArgHelpers.js';
	import { writeOutputColumn } from '$lib/tableProcesses/outputColumns.js';
	// @ts-nocheck
	// Circadian Function Index (CFI): a single 0–1 summary of rest-activity
	// rhythm robustness, combining the nonparametric variables IS, IV and RA
	// (Ortiz-Tudela et al. 2010, PLoS Comput Biol 6(11):e1000996). Reuses
	// computeNPCRA — the exact IS/IV/RA the Nonparametric RA node reports — then
	// folds them with circadianFunctionIndex(). One CFI value per y input.
	import { computeNPCRA } from '$lib/utils/npcra.js';
	import { circadianFunctionIndex } from '$lib/utils/cosinorAddons.js';

	const displayName = 'Circadian Function Index';

	// Scalar-metric ports (one value per y input, in yIN order): CFI plus the
	// raw IS/IV/RA components so users can inspect what drives it. Wire any port
	// into Compare groups / a boxplot to test across conditions.
	const defaults = new Map([
		['xIN', { val: -1 }],
		['yIN', { val: [] }],
		['epochHours', { val: 1 }],
		['period', { val: 24 }],
		['mWindow', { val: 10 }],
		['lWindow', { val: 5 }],
		['out', { CFI: { val: -1 }, IS: { val: -1 }, IV: { val: -1 }, RA: { val: -1 } }],
		['valid', { val: false }],
		['forcollected', { val: true }],
		['collectedType', { val: 'circadianfunctionindex' }],
		['preProcesses', { val: [] }],
		['tableProcesses', { val: [] }]
	]);

	export const definition = {
		displayName,
		defaults,
		func: circadianfunctionindex,
		columnIdFields: { scalar: ['xIN'], array: ['yIN'] },
		nodeSpec: {
			id: 'tableprocess.circadianfunctionindex',
			inputs: [
				{ name: 'xIN', kind: 'column', cardinality: 'one' },
				{ name: 'yIN', kind: 'column', cardinality: 'many' }
			],
			outputs: [
				{ name: 'CFI', kind: 'column', cardinality: 'one', metric: true },
				{ name: 'IS', kind: 'column', cardinality: 'one', metric: true },
				{ name: 'IV', kind: 'column', cardinality: 'one', metric: true },
				{ name: 'RA', kind: 'column', cardinality: 'one', metric: true }
			]
		}
	};

	// The metric out-keys that hold one value per y (see backfill in onMount).
	const METRIC_KEYS = ['CFI', 'IS', 'IV', 'RA'];

	// Resolve x + each y to aligned arrays, run computeNPCRA per y, derive CFI.
	// getColumnById is imported in the instance <script> below; it resolves in
	// this module block at runtime in the compiled output (same as NonparametricRA).
	export function evaluateCFI(argsIN) {
		const xCol = argsIN.xIN >= 0 ? getColumnById(argsIN.xIN) : null;
		const yINs = normalizeYInputs(argsIN.yIN);
		const opts = {
			epochHours: argsIN.epochHours ?? 1,
			period: argsIN.period ?? 24,
			mWindow: argsIN.mWindow ?? 10,
			lWindow: argsIN.lWindow ?? 5
		};
		const t = xCol ? (xCol.type === 'time' ? xCol.hoursSinceStart : xCol.getData()) : null;

		const perY = {};
		let anyValid = false;
		if (t && t.length) {
			for (const yId of yINs) {
				const yCol = yId >= 0 ? getColumnById(yId) : null;
				const y = yCol?.getData();
				if (!y || !y.length) continue;
				const res = computeNPCRA(t, y, opts);
				if (!res) continue;
				const { CFI } = circadianFunctionIndex({ IS: res.IS, IV: res.IV, RA: res.RA });
				perY[yId] = { CFI, IS: res.IS, IV: res.IV, RA: res.RA };
				anyValid = true;
			}
		}
		return { perY, yINs, anyValid };
	}

	function writeCFIOutputs(argsIN, result) {
		const processHash = crypto.randomUUID();
		const { perY, yINs } = result;
		for (const key of METRIC_KEYS) {
			const arr = yINs.map((yId) => perY[yId]?.[key] ?? NaN);
			writeOutputColumn(argsIN.out[key], arr, { processHash });
		}
	}

	export async function circadianfunctionindex(argsIN) {
		const result = evaluateCFI(argsIN);
		if (result.anyValid && argsIN?.out?.CFI !== -1) {
			writeCFIOutputs(argsIN, result);
		}
		return [result, result.anyValid];
	}
</script>

<script>
	// @ts-nocheck
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';
	import ControlInput from '$lib/components/inputs/ControlInput.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import StoreValueButton from '$lib/components/inputs/StoreValueButton.svelte';
	import { getColumnById } from '$lib/core/Column.svelte';
	import { syncMetricOutColumns } from '$lib/tableProcesses/metricOutputs.js';
	import { onMount, untrack } from 'svelte';
	import LoadingSpinner from '$lib/components/LoadingSpinner.svelte';

	let { p = $bindable(), hideInputs = false } = $props();

	migrateLegacyYIN(p.args);
	fillDefaults(p.args, defaults);

	let cfiData = $state();
	let mounted = $state(false);
	let calculating = $state(false);
	let _calcToken = 0;

	let xIN_col = $derived.by(() => (p.args.xIN >= 0 ? getColumnById(p.args.xIN) : null));
	let getHash = $derived.by(() => {
		let out = '';
		out += xIN_col?.getDataHash;
		for (const yId of p.args.yIN ?? []) {
			const col = yId >= 0 ? getColumnById(yId) : null;
			out += col?.getDataHash ?? '';
		}
		out += p.args.epochHours;
		out += p.args.period;
		out += p.args.mWindow;
		out += p.args.lWindow;
		return out;
	});
	let lastHash = p.args._fitHash ?? '';

	$effect(() => {
		const dataHash = getHash;
		if (!mounted) return;
		if (lastHash !== dataHash) {
			lastHash = getHash;
			p.args._fitHash = lastHash;
			recalculate();
		}
	});

	function recalculate() {
		calculating = true;
		const token = ++_calcToken;
		setTimeout(async () => {
			if (token !== _calcToken) return;
			const [data, valid] = await untrack(() => circadianfunctionindex(p.args));
			if (token !== _calcToken) return;
			cfiData = data;
			p.args.valid = valid;
			calculating = false;
		}, 0);
	}

	let outIds = $derived.by(() => {
		const ids = [];
		for (const key of Object.keys(p.args.out)) {
			if (p.args.out[key] >= 0) ids.push(p.args.out[key]);
		}
		return ids;
	});
	let xExcludeIds = $derived([...(p.args.yIN ?? []), ...outIds]);
	let yExcludeIds = $derived([p.args.xIN, ...outIds]);

	onMount(() => {
		// Metric out-columns are auto-seeded by the TableProcess constructor for a
		// fresh node; syncMetricOutColumns backfills any missing ones (e.g. older
		// sessions) and is idempotent otherwise.
		syncMetricOutColumns(p, METRIC_KEYS, (k) => METRIC_KEYS.includes(k));
		const hasInputs = p.args.xIN >= 0 && (p.args.yIN ?? []).some((id) => id >= 0);
		if (hasInputs) recalculate();
		mounted = true;
	});

	let rows = $derived.by(() => {
		if (!cfiData?.perY) return [];
		return (p.args.yIN ?? [])
			.filter((yId) => cfiData.perY[yId])
			.map((yId) => ({
				yId,
				name: getColumnById(Number(yId))?.name ?? String(yId),
				...cfiData.perY[yId]
			}));
	});
	const fmt = (v, dp = 3) => (Number.isFinite(v) ? v.toFixed(dp) : '—');
</script>

<div class="control-input-vertical">
	{#if !hideInputs}
		<div class="control-input">
			<p>Time (x)</p>
			<ColumnSelector bind:value={p.args.xIN} excludeColIds={xExcludeIds} />
		</div>
		<div class="control-input">
			<p>Activity (y)</p>
			<ColumnSelector multiple bind:value={p.args.yIN} excludeColIds={yExcludeIds} />
		</div>
	{/if}

	<div class="control-input-horizontal">
		<ControlInput label="Epoch (h)">
			<NumberWithUnits bind:value={p.args.epochHours} min="0.001" step="0.25" />
		</ControlInput>
		<ControlInput label="Period (h)">
			<NumberWithUnits bind:value={p.args.period} min="0.1" step="1" />
		</ControlInput>
	</div>
	<div class="control-input-horizontal">
		<ControlInput label="M window (h)">
			<NumberWithUnits bind:value={p.args.mWindow} min="0.1" step="1" />
		</ControlInput>
		<ControlInput label="L window (h)">
			<NumberWithUnits bind:value={p.args.lWindow} min="0.1" step="1" />
		</ControlInput>
	</div>
</div>

{#if calculating}
	<LoadingSpinner />
{:else if rows.length}
	<div class="cfi-results">
		<table>
			<thead>
				<tr>
					<th>Series</th>
					<th>CFI</th>
					<th>IS</th>
					<th>IV</th>
					<th>RA</th>
				</tr>
			</thead>
			<tbody>
				{#each rows as r (r.yId)}
					<tr>
						<td>{r.name}</td>
						<td>
							{fmt(r.CFI)}
							<StoreValueButton
								label="CFI"
								getter={() => r.CFI}
								defaultName={`CFI_${r.name}`}
								source="CFI"
							/>
						</td>
						<td>{fmt(r.IS)}</td>
						<td>{fmt(r.IV)}</td>
						<td>{fmt(r.RA)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
		<p class="cfi-hint">
			CFI (0–1) = mean of IS, the IV complement (2 − IV)/2, and RA, each clamped to [0,1]
			(Ortiz-Tudela et al. 2010). Higher = a more robust, well-consolidated rhythm.
		</p>
	</div>
{:else if mounted}
	<p class="cfi-hint">Select a time column and one or more activity columns.</p>
{/if}

<style>
	.cfi-results {
		margin-top: var(--space-2, 0.5rem);
		overflow-x: auto;
	}
	.cfi-results table {
		border-collapse: collapse;
		font-size: 0.8rem;
		width: 100%;
	}
	.cfi-results th,
	.cfi-results td {
		border: 1px solid var(--color-lightness-90);
		padding: 0.2rem 0.4rem;
		text-align: right;
		white-space: nowrap;
	}
	.cfi-results th:first-child,
	.cfi-results td:first-child {
		text-align: left;
	}
	.cfi-hint {
		font-size: var(--font-sm);
		opacity: 0.7;
		margin-top: var(--space-2, 0.5rem);
		line-height: 1.35;
	}
</style>
