<script module>
	// @ts-nocheck
	// Nonparametric Circadian Rhythm Analysis (NPCRA): IS, IV, RA, M10, L5 and
	// their onsets, computed on activity folded onto an average 24 h profile.
	// Robust to the highly non-sinusoidal rest-activity rhythm where cosinor is
	// insensitive (Van Someren et al. 1999, Chronobiol Int 16(4):505-518).
	import { core } from '$lib/core/core.svelte';
	import ControlInput from '$lib/components/inputs/ControlInput.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import { computeNPCRA } from '$lib/utils/npcra.js';

	const displayName = 'Nonparametric RA';

	// Scalar-metric ports (one value per y input) + the average-day profile curve
	// (npcrax shared X, npcray_<id> per Y) — same "stored values as ports" pattern
	// as Cosinor, so IS/IV/RA wire straight into Compare groups / Boxplot.
	const defaults = new Map([
		['xIN', { val: -1 }],
		['yIN', { val: [] }],
		['epochHours', { val: 1 }],
		['period', { val: 24 }],
		['mWindow', { val: 10 }],
		['lWindow', { val: 5 }],
		[
			'out',
			{
				npcrax: { val: -1 },
				IS: { val: -1 },
				IV: { val: -1 },
				RA: { val: -1 },
				M10: { val: -1 },
				L5: { val: -1 },
				M10onset: { val: -1 },
				L5onset: { val: -1 }
			}
		],
		['valid', { val: false }],
		['forcollected', { val: true }],
		['collectedType', { val: 'npcra' }],
		['preProcesses', { val: [] }],
		['tableProcesses', { val: [] }]
	]);

	export const definition = {
		displayName,
		defaults,
		func: nonparametricRA,
		columnIdFields: { scalar: ['xIN'], array: ['yIN'] },
		xOutKey: 'npcrax',
		yOutKeyPrefix: 'npcray_',
		nodeSpec: {
			id: 'tableprocess.nonparametricra',
			inputs: [
				{ name: 'xIN', kind: 'column', cardinality: 'one' },
				{ name: 'yIN', kind: 'column', cardinality: 'many' }
			],
			outputs: [
				{ name: 'npcrax', kind: 'column', cardinality: 'one' },
				{ name: 'npcray_*', kind: 'column', cardinality: 'many', dynamicPrefix: 'npcray_' },
				{ name: 'IS', kind: 'column', cardinality: 'one' },
				{ name: 'IV', kind: 'column', cardinality: 'one' },
				{ name: 'RA', kind: 'column', cardinality: 'one' },
				{ name: 'M10', kind: 'column', cardinality: 'one' },
				{ name: 'L5', kind: 'column', cardinality: 'one' },
				{ name: 'M10onset', kind: 'column', cardinality: 'one' },
				{ name: 'L5onset', kind: 'column', cardinality: 'one' }
			]
		}
	};

	const SCALAR_KEYS = ['IS', 'IV', 'RA', 'M10', 'L5', 'M10onset', 'L5onset'];

	// Resolve x + each y to aligned numeric arrays, then run computeNPCRA per y.
	// Returns { perY: { [yId]: result }, binCentres, anyValid }.
	// NB: getColumnById is imported in the instance <script> below; it resolves in
	// this module block at runtime in the compiled output (same as Cosinor.svelte).
	export function evaluateNPCRA(argsIN) {
		const xCol = argsIN.xIN >= 0 ? getColumnById(argsIN.xIN) : null;
		let yINs = argsIN.yIN;
		if (!Array.isArray(yINs)) yINs = yINs != null && yINs !== -1 ? [yINs] : [];

		const opts = {
			epochHours: argsIN.epochHours ?? 1,
			period: argsIN.period ?? 24,
			mWindow: argsIN.mWindow ?? 10,
			lWindow: argsIN.lWindow ?? 5
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
				const res = computeNPCRA(t, y, opts);
				if (res) {
					perY[yId] = res;
					if (!binCentres) binCentres = res.binCentres;
					anyValid = true;
				}
			}
		}
		return { perY, binCentres, anyValid, yINs };
	}

	// Write the profile curve + scalar-metric columns for a committed TP.
	function writeNPCRAOutputs(argsIN, result) {
		const processHash = crypto.randomUUID();
		const { perY, binCentres, yINs } = result;

		const xOUT = argsIN.out.npcrax;
		if (xOUT != null && xOUT !== -1 && binCentres) {
			const col = getColumnById(xOUT);
			if (col) {
				core.rawData.set(xOUT, binCentres);
				col.data = xOUT;
				col.type = 'number';
				col.tableProcessGUId = processHash;
			}
		}

		for (const yId of yINs) {
			const outKey = 'npcray_' + yId;
			const yOUT = argsIN.out[outKey];
			const res = perY[yId];
			if (yOUT != null && yOUT !== -1 && res) {
				const col = getColumnById(yOUT);
				if (col) {
					core.rawData.set(yOUT, res.profile);
					col.data = yOUT;
					col.type = 'number';
					col.tableProcessGUId = processHash;
				}
			}
		}

		// Scalar ports: one value per y input, in yIN order.
		for (const key of SCALAR_KEYS) {
			const id = argsIN.out[key];
			if (id == null || id === -1) continue;
			const col = getColumnById(id);
			if (!col) continue;
			const arr = yINs.map((yId) => perY[yId]?.[key] ?? NaN);
			core.rawData.set(id, arr);
			col.data = id;
			col.type = 'number';
			col.tableProcessGUId = processHash;
		}
	}

	export async function nonparametricRA(argsIN) {
		const result = evaluateNPCRA(argsIN);
		if (result.anyValid && argsIN?.out?.npcrax !== -1) {
			writeNPCRAOutputs(argsIN, result);
		}
		return [result, result.anyValid];
	}
</script>

<script>
	// @ts-nocheck
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';
	import ColumnComponent from '$lib/core/Column.svelte';
	import StoreValueButton from '$lib/components/inputs/StoreValueButton.svelte';
	import { Column, getColumnById } from '$lib/core/Column.svelte';
	import { pushObj } from '$lib/core/core.svelte.js';
	import { useMultiYTP } from '$lib/tableProcesses/useMultiYTP.svelte.js';
	import { onMount, untrack } from 'svelte';
	import LoadingSpinner from '$lib/components/LoadingSpinner.svelte';

	let { p = $bindable(), hideInputs = false } = $props();

	// Backward compat: single yIN → array.
	if (typeof p.args.yIN === 'number') {
		p.args.yIN = p.args.yIN !== -1 ? [p.args.yIN] : [];
	}
	// Defaults for fields absent in older sessions.
	if (p.args.epochHours === undefined) p.args.epochHours = 1;
	if (p.args.period === undefined) p.args.period = 24;
	if (p.args.mWindow === undefined) p.args.mWindow = 10;
	if (p.args.lWindow === undefined) p.args.lWindow = 5;

	let npcraData = $state();
	let mounted = $state(false);
	let calculating = $state(false);
	let _calcToken = 0;

	const { syncYColumns, initYColumns } = useMultiYTP(p, 'npcray_', 'npcra_');

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

	// Reconcile per-Y profile columns when yIN changes.
	$effect(() => {
		p.args.yIN;
		if (!mounted) return;
		untrack(() => {
			if (syncYColumns()) recalculate();
		});
	});

	function recalculate() {
		calculating = true;
		const token = ++_calcToken;
		setTimeout(async () => {
			if (token !== _calcToken) return;
			const [data, valid] = await untrack(() => nonparametricRA(p.args));
			if (token !== _calcToken) return;
			npcraData = data;
			p.args.valid = valid;
			calculating = false;
		}, 0);
	}

	// Own output columns — never selectable as an input on either axis.
	let outIds = $derived.by(() => {
		const ids = [];
		for (const key of Object.keys(p.args.out)) {
			if (p.args.out[key] >= 0) ids.push(p.args.out[key]);
		}
		return ids;
	});
	// x must not offer the y columns or the outputs (but must still show itself).
	let xExcludeIds = $derived([...(p.args.yIN ?? []), ...outIds]);
	// y must not offer the x column or the outputs.
	let yExcludeIds = $derived([p.args.xIN, ...outIds]);

	onMount(() => {
		let needsCompute = false;
		if (p.args.out.npcrax == null || p.args.out.npcrax < 0) {
			if (p.parent) {
				const xCol = new Column({});
				xCol.name = 'npcrax_' + p.id;
				pushObj(xCol);
				p.parent.columnRefs = [xCol.id, ...p.parent.columnRefs];
				p.args.out.npcrax = xCol.id;
				needsCompute = true;
			}
		}
		if (initYColumns()) needsCompute = true;
		// Always compute on mount when inputs are present: this component also
		// mounts a fresh instance in the control panel (CanvasNodeControls), which
		// has its own `npcraData` state. NPCRA is O(n) and synchronous, so simply
		// recomputing is cheaper and simpler than Cosinor-style rehydration.
		const hasInputs = p.args.xIN >= 0 && (p.args.yIN ?? []).some((id) => id >= 0);
		if (needsCompute || hasInputs) recalculate();
		mounted = true;
	});

	// Per-Y metrics for the results table (read straight off the computed result).
	let rows = $derived.by(() => {
		if (!npcraData?.perY) return [];
		return (p.args.yIN ?? [])
			.filter((yId) => npcraData.perY[yId])
			.map((yId) => ({ yId, name: getColumnById(Number(yId))?.name ?? String(yId), ...npcraData.perY[yId] }));
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
	<div class="npcra-results">
		<table>
			<thead>
				<tr>
					<th>Series</th>
					<th>IS</th>
					<th>IV</th>
					<th>RA</th>
					<th>M10</th>
					<th>L5</th>
					<th>M10 onset</th>
					<th>L5 onset</th>
				</tr>
			</thead>
			<tbody>
				{#each rows as r (r.yId)}
					<tr>
						<td>{r.name}</td>
						<td>
							{fmt(r.IS)}
							<StoreValueButton label="IS" getter={() => r.IS} defaultName={`IS_${r.name}`} source="NPCRA" />
						</td>
						<td>
							{fmt(r.IV)}
							<StoreValueButton label="IV" getter={() => r.IV} defaultName={`IV_${r.name}`} source="NPCRA" />
						</td>
						<td>
							{fmt(r.RA)}
							<StoreValueButton label="RA" getter={() => r.RA} defaultName={`RA_${r.name}`} source="NPCRA" />
						</td>
						<td>{fmt(r.M10, 2)}</td>
						<td>{fmt(r.L5, 2)}</td>
						<td>{fmt(r.M10onset, 1)}</td>
						<td>{fmt(r.L5onset, 1)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
		<p class="npcra-hint">
			IS = coupling to the day (0–1), IV = fragmentation (~0 rhythmic, ~2 noise), RA = relative
			amplitude. Wire any output port into <em>Compare groups</em> or a boxplot to test across
			conditions.
		</p>
	</div>
{:else if mounted}
	<p class="npcra-hint">Select a time column and one or more activity columns.</p>
{/if}

<style>
	.npcra-results {
		margin-top: var(--space-2, 0.5rem);
		overflow-x: auto;
	}
	.npcra-results table {
		border-collapse: collapse;
		font-size: 0.8rem;
		width: 100%;
	}
	.npcra-results th,
	.npcra-results td {
		border: 1px solid var(--color-lightness-90, #e7e7e7);
		padding: 0.2rem 0.4rem;
		text-align: right;
		white-space: nowrap;
	}
	.npcra-results th:first-child,
	.npcra-results td:first-child {
		text-align: left;
	}
	.npcra-hint {
		font-size: 0.75rem;
		opacity: 0.7;
		margin-top: var(--space-2, 0.5rem);
		line-height: 1.35;
	}
</style>
