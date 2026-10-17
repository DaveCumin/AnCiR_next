<script module>
	import { scrollFade } from '$lib/utils/scrollFade.js';
	import { normalizeYInputs, migrateLegacyYIN } from '$lib/tableProcesses/tpArgHelpers.js';
	import { writeOutputColumn } from '$lib/tableProcesses/outputColumns.js';
	// @ts-nocheck
	// Nonparametric Circadian Rhythm Analysis (NPCRA): IS, IV, RA, M10, L5 and
	// their onsets, computed on activity folded onto an average 24 h profile.
	// Robust to the highly non-sinusoidal rest-activity rhythm where cosinor is
	// insensitive (Van Someren et al. 1999, Chronobiol Int 16(4):505-518).
	import { nodeMemo } from '$lib/core/computeMemo.js';
	import ControlInput from '$lib/components/inputs/ControlInput.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import { computeNPCRA, missingEpochWarning } from '$lib/utils/npcra.js';
	import {
		applyPhaseReference,
		relabelFoldedProfile,
		PHASE_REFERENCE_START
	} from '$lib/utils/phaseReference.js';
	import { resolveNodePhaseReference } from '$lib/tableProcesses/phaseReferenceSupport.js';

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
		// What hour 0 means for M10onset / L5onset and the average-day time axis:
		// 'start' = hours after the first sample (the default, and what saved sessions
		// report), 'clock' = hours after local midnight in the display timezone, wrapped
		// to the period. Only relabels: IS, IV, RA, M10 and L5 never change. Review FIT-9.
		['phaseReference', { val: PHASE_REFERENCE_START }],
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
				{ name: 'IS', kind: 'column', cardinality: 'one', metric: true },
				{ name: 'IV', kind: 'column', cardinality: 'one', metric: true },
				{ name: 'RA', kind: 'column', cardinality: 'one', metric: true },
				{ name: 'M10', kind: 'column', cardinality: 'one', metric: true },
				{ name: 'L5', kind: 'column', cardinality: 'one', metric: true },
				{ name: 'M10onset', kind: 'column', cardinality: 'one', metric: true },
				{ name: 'L5onset', kind: 'column', cardinality: 'one', metric: true }
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
		const yINs = normalizeYInputs(argsIN.yIN);

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
		// Clock time (FIT-9) only relabels the phase outputs: each onset and bin time is
		// measured from its series' first sample (t0, which is hour 0 of a time column),
		// so clock time adds t0 plus the origin's clock hour and wraps to the period.
		const phaseRef = resolveNodePhaseReference(argsIN, xCol);
		if (t && t.length) {
			for (const yId of yINs) {
				const yCol = yId >= 0 ? getColumnById(yId) : null;
				const y = yCol?.getData();
				if (!y || !y.length) continue;
				const res = computeNPCRA(t, y, opts);
				if (res) {
					if (phaseRef.clock) {
						const ref = { clock: true, offsetHours: phaseRef.offsetHours + res.t0 };
						res.M10onset = applyPhaseReference(res.M10onset, ref, opts.period);
						res.L5onset = applyPhaseReference(res.L5onset, ref, opts.period);
						const r = relabelFoldedProfile(res.binCentres, [res.profile], ref, opts.period);
						res.binCentres = r.binTimes;
						res.profile = r.series[0];
					}
					perY[yId] = res;
					if (!binCentres) binCentres = res.binCentres;
					anyValid = true;
				}
			}
		}
		const warnings = npcraSampleWarnings(t, perY, opts);
		if (phaseRef.warning) warnings.push(phaseRef.warning);
		return { perY, binCentres, anyValid, yINs, phaseRef, warnings };
	}

	// IS and IV are DAY-based statistics, so the sample size that matters is the
	// number of cycles recorded, not the number of rows. A week is the usual
	// minimum quoted for a stable interdaily stability estimate (Van Someren et
	// al. 1999; Witting et al. 1990 use 7+ days), because IS is essentially a
	// between-day ANOVA and a handful of days leaves it very noisy.
	const NPCRA_MIN_DAYS = 7;
	// IV is a lag-1 difference over epochs; too few epochs per cycle and it is
	// dominated by the binning rather than the behaviour.
	const NPCRA_MIN_EPOCHS_PER_CYCLE = 8;

	function npcraSampleWarnings(t, perY, opts) {
		const warnings = [];
		if (!t || !t.length || !Object.keys(perY).length) return warnings;

		const finite = t.filter((v) => v != null && Number.isFinite(Number(v))).map(Number);
		if (finite.length < 2) return warnings;
		// Loop rather than Math.max(...finite): a spread of a long series overflows the stack.
		let lo = Infinity;
		let hi = -Infinity;
		for (const v of finite) {
			if (v < lo) lo = v;
			if (v > hi) hi = v;
		}
		const spanHours = hi - lo;
		const period = opts.period || 24;
		const days = spanHours / period;

		if (days < NPCRA_MIN_DAYS) {
			warnings.push(
				`Short recording: ${days.toFixed(1)} cycles of data (about ${days.toFixed(1)} days at a ${period} h period). Interdaily stability is a between-day statistic and is very noisy below ~${NPCRA_MIN_DAYS} days; IS and RA here should be read as indicative, not quantitative.`
			);
		}

		const epochsPerCycle = period / (opts.epochHours || 1);
		if (epochsPerCycle < NPCRA_MIN_EPOCHS_PER_CYCLE) {
			warnings.push(
				`Coarse epochs: only ${epochsPerCycle.toFixed(1)} bins per ${period} h cycle at a ${opts.epochHours} h epoch. Intradaily variability measures hour-to-hour fragmentation, so with this few bins it mostly reflects the binning rather than the behaviour, so shorten the epoch if the data allow.`
			);
		}

		// FIT-8: many empty epochs thin the record IS and IV rest on (IV is now divided by
		// the valid successive pairs, so it is not biased, but it is noisier).
		for (const [yId, res] of Object.entries(perY)) {
			const name = getColumnById(Number(yId))?.name ?? `column ${yId}`;
			const w = missingEpochWarning(name, res.missingEpochFraction, opts.epochHours);
			if (w) warnings.push(w);
		}

		// L5/M10 windows cannot both be estimated if they do not fit in the cycle.
		if ((opts.mWindow ?? 10) + (opts.lWindow ?? 5) > period) {
			warnings.push(
				`The M (${opts.mWindow} h) and L (${opts.lWindow} h) windows together exceed the ${period} h period, so they necessarily overlap and RA is not interpretable as a peak-to-trough contrast.`
			);
		}
		return warnings;
	}

	// Write the profile curve + scalar-metric columns for a committed TP.
	function writeNPCRAOutputs(argsIN, result) {
		const processHash = crypto.randomUUID();
		const { perY, binCentres, yINs } = result;

		if (binCentres) {
			writeOutputColumn(argsIN.out.npcrax, binCentres, { processHash });
		}

		for (const yId of yINs) {
			const yOUT = argsIN.out['npcray_' + yId];
			const res = perY[yId];
			if (yOUT != null && yOUT !== -1 && res) {
				writeOutputColumn(yOUT, res.profile, { processHash });
			}
		}

		// Scalar ports: one value per y input, in yIN order.
		for (const key of SCALAR_KEYS) {
			const arr = yINs.map((yId) => perY[yId]?.[key] ?? NaN);
			writeOutputColumn(argsIN.out[key], arr, { processHash });
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
	import StoreValueButton from '$lib/components/inputs/StoreValueButton.svelte';
	import { provideStoredValueOwner } from '$lib/core/storedValueClaims.js';
	import { Column, getColumnById } from '$lib/core/Column.svelte';
	import { pushObj } from '$lib/core/core.svelte.js';
	import { useMultiYTP } from '$lib/tableProcesses/useMultiYTP.svelte.js';
	import { onMount, untrack } from 'svelte';
	import LoadingSpinner from '$lib/components/LoadingSpinner.svelte';
	import ErrorBox from '$lib/components/reusables/ErrorBox.svelte';
	import { createComputeRunner } from '$lib/core/asyncCompute.js';
	import { clearOutputColumns } from '$lib/tableProcesses/outputColumns.js';
	import PhaseReferenceSelect from '$lib/components/inputs/PhaseReferenceSelect.svelte';
	import { appState } from '$lib/core/core.svelte';

	let { p = $bindable(), hideInputs = false } = $props();
	// Every stored-value button here is one entry per node, however many copies of this
	// node are mounted (canvas + control panel): see storedValueClaims.js.
	provideStoredValueOwner('tp', () => p?.id);

	// Backward compat: single yIN → array.
	migrateLegacyYIN(p.args);
	// Defaults for fields absent in older sessions.
	if (p.args.epochHours === undefined) p.args.epochHours = 1;
	if (p.args.period === undefined) p.args.period = 24;
	if (p.args.mWindow === undefined) p.args.mWindow = 10;
	if (p.args.lWindow === undefined) p.args.lWindow = 5;

	let npcraData = $state();
	let mounted = $state(false);
	let calculating = $state(false);
	// The message of the last failed compute, shown with a Retry (ROB-11).
	let calcError = $state(null);

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
		if (npcraData !== undefined) memo.payload = npcraData;
	});
	function restore(cached) {
		npcraData = cached;
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
			p.args._fitHash = memo.hash;
			recalculate();
		}
	});

	// Reconcile per-Y profile columns when yIN changes.
	$effect(() => {
		p.args.yIN;
		if (!mounted) return;
		// Defer reconcile out of the effect: syncYColumns() calls `new Column()`, whose
		// $derived fields go inert if created while this effect is the active reaction
		// (Svelte derived_inert). A microtask runs with no active effect → root-owned.
		queueMicrotask(() =>
			untrack(() => {
				if (syncYColumns()) recalculate();
			})
		);
	});

	// try/finally, error state, success-only memo commit: see core/asyncCompute.js.
	const runner = createComputeRunner({
		memo,
		node: p,
		label: 'Nonparametric rhythm analysis',
		setBusy: (v) => (calculating = v),
		setError: (m) => (calcError = m)
	});
	function recalculate() {
		runner.run(
			untrack(() => getHash),
			() => untrack(() => nonparametricRA(p.args)),
			([data, valid]) => {
				npcraData = data;
				// Surfaces on the canvas node too (CompactNode / TableProcessNode read tp.warnings).
				p.warnings = data?.warnings ?? [];
				p.args.valid = valid;
			},
			() => {
				npcraData = undefined;
				p.warnings = [];
				p.args.valid = false;
				clearOutputColumns(p.args.out);
			}
		);
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
		// Put the previous result back before anything else: the compute effect
		// skips when nothing changed, and this state died with the last instance.
		if (memo.has(getHash)) restore(memo.payload);
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
			.map((yId) => ({
				yId,
				name: getColumnById(Number(yId))?.name ?? String(yId),
				...npcraData.perY[yId]
			}));
	});
	const fmt = (v, dp = 3) => (Number.isFinite(v) ? v.toFixed(dp) : '—');
	// Onsets are hours after the first sample unless the node reports clock time (FIT-9).
	let onsetUnit = $derived(npcraData?.phaseRef?.clock ? 'clock time, h' : 'h after start');
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
	<div class="control-input-horizontal">
		<PhaseReferenceSelect
			bind:value={p.args.phaseReference}
			xIsTime={xIN_col?.type === 'time'}
			numericOrigin="the first sample"
		/>
	</div>
</div>

{#if calculating}
	<LoadingSpinner />
{:else if calcError}
	<ErrorBox title="The analysis failed." message={calcError} onretry={recalculate} />
{:else if rows.length}
	<div class="npcra-results scroll-fade-x" {@attach scrollFade()}>
		<table>
			<thead>
				<tr>
					<th>Series</th>
					<th>IS</th>
					<th>IV</th>
					<th>RA</th>
					<th>M{p.args.mWindow}</th>
					<th>L{p.args.lWindow}</th>
					<th>M{p.args.mWindow} onset ({onsetUnit})</th>
					<th>L{p.args.lWindow} onset ({onsetUnit})</th>
				</tr>
			</thead>
			<tbody>
				{#each rows as r (r.yId)}
					<tr>
						<td>{r.name}</td>
						<td>
							{fmt(r.IS)}
							<StoreValueButton
								label="IS"
								getter={() => r.IS}
								defaultName={`IS_${r.name}`}
								source="NPCRA"
							/>
						</td>
						<td>
							{fmt(r.IV)}
							<StoreValueButton
								label="IV"
								getter={() => r.IV}
								defaultName={`IV_${r.name}`}
								source="NPCRA"
							/>
						</td>
						<td>
							{fmt(r.RA)}
							<StoreValueButton
								label="RA"
								getter={() => r.RA}
								defaultName={`RA_${r.name}`}
								source="NPCRA"
							/>
						</td>
						<td>{fmt(r.M10, 2)}</td>
						<td>{fmt(r.L5, 2)}</td>
						<td>{fmt(r.M10onset, 1)}</td>
						<td>{fmt(r.L5onset, 1)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
		{#each npcraData?.warnings ?? [] as w (w)}
			<p class="warn">{w}</p>
		{/each}
		<p class="npcra-hint">
			IS = coupling to the day (0–1), IV = fragmentation (~0 rhythmic, ~2 noise), RA = relative
			amplitude. Wire any output port into <em>Compare groups</em> or a boxplot to test across conditions.
		</p>
	</div>
{:else if mounted}
	<p class="npcra-hint">Select a time column and one or more activity columns.</p>
{/if}

<style>
	/* Matches ChiSquared / Rayleigh so a warning reads the same wherever it appears. */
	.warn {
		font-size: var(--font-xs);
		color: var(--color-warning-text);
		background: var(--color-warning-bg);
		border-radius: var(--radius-sm);
		padding: var(--space-1) var(--space-2);
		margin: var(--space-1) 0 0;
	}
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
		border: 1px solid var(--color-lightness-90);
		padding: 0.2rem 0.4rem;
		text-align: right;
		white-space: nowrap;
	}
	.npcra-results th:first-child,
	.npcra-results td:first-child {
		text-align: left;
	}
	.npcra-hint {
		font-size: var(--font-sm);
		opacity: 0.7;
		margin-top: var(--space-2, 0.5rem);
		line-height: 1.35;
	}
</style>
