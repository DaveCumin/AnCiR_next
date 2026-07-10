<script module>
	import { normalizeYInputs, migrateLegacyYIN } from '$lib/tableProcesses/tpArgHelpers.js';
	import { writeOutputColumn } from '$lib/tableProcesses/outputColumns.js';
	// @ts-nocheck
	// Average daily profile: fold each activity series onto a single period and
	// report the per-phase-bin mean (± SEM). The "average day" view. Shares the
	// fold used inside NonparametricRA, exposed as a standalone node so it can be
	// run without a full NPCRA pass and its profile wired into plots/comparisons.
	import { core } from '$lib/core/core.svelte';
	import ControlInput from '$lib/components/inputs/ControlInput.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import { averageDailyProfile } from '$lib/utils/averageProfile.js';

	const displayName = 'Average Profile';

	// Outputs: a shared X (bin centres) + one profile column per Y (avgprof_<id>)
	// + one SEM column per Y (avgprofsem_<id>).
	const defaults = new Map([
		['xIN', { val: -1 }],
		['yIN', { val: [] }],
		['period', { val: 24 }],
		['nBins', { val: 24 }],
		[
			'out',
			{
				avgprofx: { val: -1 }
			}
		],
		['valid', { val: false }],
		['forcollected', { val: true }],
		['collectedType', { val: 'averageprofile' }],
		['preProcesses', { val: [] }],
		['tableProcesses', { val: [] }]
	]);

	export const definition = {
		displayName,
		defaults,
		func: averageProfile,
		columnIdFields: { scalar: ['xIN'], array: ['yIN'] },
		xOutKey: 'avgprofx',
		yOutKeyPrefix: 'avgprof_',
		nodeSpec: {
			id: 'tableprocess.averageprofile',
			inputs: [
				{ name: 'xIN', kind: 'column', cardinality: 'one' },
				{ name: 'yIN', kind: 'column', cardinality: 'many' }
			],
			outputs: [
				{ name: 'avgprofx', kind: 'column', cardinality: 'one' },
				{ name: 'avgprof_*', kind: 'column', cardinality: 'many', dynamicPrefix: 'avgprof_' },
				{ name: 'avgprofsem_*', kind: 'column', cardinality: 'many', dynamicPrefix: 'avgprofsem_' }
			]
		}
	};

	// Resolve x + each y to aligned numeric arrays, then fold each y.
	// Returns { perY: { [yId]: {profile, sem, n} }, binCentres, anyValid, yINs }.
	export function evaluateAverageProfile(argsIN) {
		const xCol = argsIN.xIN >= 0 ? getColumnById(argsIN.xIN) : null;
		const yINs = normalizeYInputs(argsIN.yIN);
		const opts = {
			period: argsIN.period ?? 24,
			nBins: argsIN.nBins ?? 24
		};
		const t = xCol ? (xCol.type === 'time' ? xCol.hoursSinceStart : xCol.getData()) : null;

		const perY = {};
		let binCentres = null;
		let anyValid = false;
		if (t && t.length) {
			for (const yId of yINs) {
				const yCol = yId >= 0 ? getColumnById(yId) : null;
				const y = yCol?.getData();
				if (!y || !y.length) continue;
				const res = averageDailyProfile(t, y, opts);
				if (res && res.binCentres.length) {
					perY[yId] = res;
					if (!binCentres) binCentres = res.binCentres;
					if (res.n.some((c) => c > 0)) anyValid = true;
				}
			}
		}
		return { perY, binCentres, anyValid, yINs };
	}

	// Write the shared bin-centre X + per-Y profile + per-Y SEM columns.
	function writeAverageProfileOutputs(argsIN, result) {
		const processHash = crypto.randomUUID();
		const { perY, binCentres, yINs } = result;

		if (binCentres) {
			writeOutputColumn(argsIN.out.avgprofx, binCentres, { processHash });
		}
		for (const yId of yINs) {
			const res = perY[yId];
			if (!res) continue;
			const yOUT = argsIN.out['avgprof_' + yId];
			if (yOUT != null && yOUT !== -1) writeOutputColumn(yOUT, res.profile, { processHash });
			const semOUT = argsIN.out['avgprofsem_' + yId];
			if (semOUT != null && semOUT !== -1) writeOutputColumn(semOUT, res.sem, { processHash });
		}
	}

	export function averageProfile(argsIN) {
		const result = evaluateAverageProfile(argsIN);
		if (result.anyValid && argsIN?.out?.avgprofx !== -1) {
			writeAverageProfileOutputs(argsIN, result);
		}
		return [result, result.anyValid];
	}
</script>

<script>
	// @ts-nocheck
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';
	import { Column, getColumnById } from '$lib/core/Column.svelte';
	import { pushObj } from '$lib/core/core.svelte.js';
	import { useMultiYTP } from '$lib/tableProcesses/useMultiYTP.svelte.js';
	import { onMount, untrack } from 'svelte';
	import LoadingSpinner from '$lib/components/LoadingSpinner.svelte';

	let { p = $bindable(), hideInputs = false } = $props();

	// Backward compat: single yIN → array.
	migrateLegacyYIN(p.args);
	if (p.args.period === undefined) p.args.period = 24;
	if (p.args.nBins === undefined) p.args.nBins = 24;

	let profData = $state();
	let mounted = $state(false);
	let calculating = $state(false);
	let _calcToken = 0;

	// Two per-Y output families: the profile (avgprof_) and its SEM (avgprofsem_).
	// The TableProcess constructor auto-seeds the avgprof_ family from
	// yOutKeyPrefix; the SEM family is managed entirely here.
	const profileY = useMultiYTP(p, 'avgprof_', 'avgprof_');
	const semY = useMultiYTP(p, 'avgprofsem_', 'avgprofsem_');

	function syncOutputs() {
		let changed = profileY.syncYColumns();
		if (semY.syncYColumns()) changed = true;
		return changed;
	}

	let xIN_col = $derived.by(() => (p.args.xIN >= 0 ? getColumnById(p.args.xIN) : null));
	let getHash = $derived.by(() => {
		let out = '';
		out += xIN_col?.getDataHash;
		for (const yId of p.args.yIN ?? []) {
			const col = yId >= 0 ? getColumnById(yId) : null;
			out += col?.getDataHash ?? '';
		}
		out += p.args.period;
		out += p.args.nBins;
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

	// Reconcile per-Y output columns when yIN changes — deferred out of the effect
	// so `new Column()` runs with no active reaction (Svelte derived_inert).
	$effect(() => {
		p.args.yIN;
		if (!mounted) return;
		queueMicrotask(() =>
			untrack(() => {
				if (syncOutputs()) recalculate();
			})
		);
	});

	function recalculate() {
		calculating = true;
		const token = ++_calcToken;
		setTimeout(() => {
			if (token !== _calcToken) return;
			const [data, valid] = untrack(() => averageProfile(p.args));
			if (token !== _calcToken) return;
			profData = data;
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
		let needsCompute = false;
		if (p.args.out.avgprofx == null || p.args.out.avgprofx < 0) {
			if (p.parent) {
				const xCol = new Column({});
				xCol.name = 'avgprofx_' + p.id;
				pushObj(xCol);
				p.parent.columnRefs = [xCol.id, ...p.parent.columnRefs];
				p.args.out.avgprofx = xCol.id;
				needsCompute = true;
			}
		}
		if (profileY.initYColumns()) needsCompute = true;
		if (semY.initYColumns()) needsCompute = true;
		const hasInputs = p.args.xIN >= 0 && (p.args.yIN ?? []).some((id) => id >= 0);
		if (needsCompute || hasInputs) recalculate();
		mounted = true;
	});

	// Per-Y summary rows for the results table.
	let rows = $derived.by(() => {
		if (!profData?.perY) return [];
		return (p.args.yIN ?? [])
			.filter((yId) => profData.perY[yId])
			.map((yId) => {
				const res = profData.perY[yId];
				const nTotal = res.n.reduce((a, b) => a + b, 0);
				const filled = res.n.filter((c) => c > 0).length;
				return {
					yId,
					name: getColumnById(Number(yId))?.name ?? String(yId),
					nTotal,
					filled,
					nBins: res.profile.length
				};
			});
	});
</script>

<div class="control-input-vertical">
	{#if !hideInputs}
		<div class="control-input">
			<p>Time (x)</p>
			<ColumnSelector bind:value={p.args.xIN} excludeColIds={xExcludeIds} />
		</div>
		<div class="control-input">
			<p>Values (y)</p>
			<ColumnSelector multiple bind:value={p.args.yIN} excludeColIds={yExcludeIds} />
		</div>
	{/if}

	<div class="control-input-horizontal">
		<ControlInput label="Period (h)">
			<NumberWithUnits bind:value={p.args.period} min="0.1" step="1" />
		</ControlInput>
		<ControlInput label="Bins">
			<NumberWithUnits bind:value={p.args.nBins} min="1" step="1" />
		</ControlInput>
	</div>
</div>

{#if calculating}
	<LoadingSpinner />
{:else if rows.length}
	<div class="avgprof-results">
		<table>
			<thead>
				<tr>
					<th>Series</th>
					<th>Points</th>
					<th>Bins filled</th>
				</tr>
			</thead>
			<tbody>
				{#each rows as r (r.yId)}
					<tr>
						<td>{r.name}</td>
						<td>{r.nTotal}</td>
						<td>{r.filled} / {r.nBins}</td>
					</tr>
				{/each}
			</tbody>
		</table>
		<p class="avgprof-hint">
			Each series is folded onto one period and averaged per phase bin. Wire <em>avgprofx</em> vs a profile
			output into a plot for the average-day waveform; the SEM output gives per-bin error.
		</p>
	</div>
{:else if mounted}
	<p class="avgprof-hint">Select a time column and one or more value columns.</p>
{/if}

<style>
	.avgprof-results {
		margin-top: var(--space-2, 0.5rem);
		overflow-x: auto;
	}
	.avgprof-results table {
		border-collapse: collapse;
		font-size: 0.8rem;
		width: 100%;
	}
	.avgprof-results th,
	.avgprof-results td {
		border: 1px solid var(--color-lightness-90);
		padding: 0.2rem 0.4rem;
		text-align: right;
		white-space: nowrap;
	}
	.avgprof-results th:first-child,
	.avgprof-results td:first-child {
		text-align: left;
	}
	.avgprof-hint {
		font-size: var(--font-sm);
		opacity: 0.7;
		margin-top: var(--space-2, 0.5rem);
		line-height: 1.35;
	}
</style>
