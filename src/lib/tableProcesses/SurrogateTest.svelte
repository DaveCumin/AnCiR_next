<script module>
	// Surrogate significance test — is the rhythm in this series stronger than a
	// null that KEEPS its nuisance structure?
	//
	// The point of this node over the permutation test already built into the fit
	// nodes: plain shuffling destroys autocorrelation, and real time series are
	// autocorrelated whether or not they are rhythmic, so a shuffle null is far too
	// easy to beat. These surrogates preserve the structure and randomise only the
	// part under test. See utils/surrogates.js for which null answers which
	// question — the pairing matters, and the node surfaces a warning when it is
	// wrong (surrogateAdvice).
	import { core } from '$lib/core/core.svelte';
	import { nodeMemo, restoreOrCompute } from '$lib/core/computeMemo.js';
	import { getColumnById } from '$lib/core/Column.svelte';
	import { surrogateTest, surrogateAdvice, SURROGATE_METHODS } from '$lib/utils/surrogates.js';
	import { computeFFT } from '$lib/utils/fft.js';

	const displayName = 'Surrogate Test';

	const defaults = new Map([
		['xIN', { val: -1 }], // time
		['yIN', { val: -1 }], // values
		['method', { val: 'block' }],
		['nSurrogates', { val: 199 }],
		['seed', { val: 12345 }],
		['blockLengthHours', { val: 24 }],
		['periodMin', { val: 20 }],
		['periodMax', { val: 28 }],
		['out', { pvalue: { val: -1 }, observed: { val: -1 } }],
		['valid', { val: false }]
	]);

	/**
	 * Peak spectral power inside the target period band.
	 *
	 * Band-limited on purpose. A global spectral maximum is the wrong statistic
	 * against a red-noise null: an AR(1) fitted to a smooth rhythm has alpha near
	 * 1 and piles power at the LOWEST frequencies, so a global max compares a 24 h
	 * peak against a 200 h one and the test loses all power.
	 */
	function bandPowerStatistic(times, periodMin, periodMax) {
		return (y) => {
			const { frequencies, magnitudes } = computeFFT(times.slice(0, y.length), y);
			let best = 0;
			for (let i = 0; i < frequencies.length; i++) {
				const period = 1 / frequencies[i];
				if (period >= periodMin && period <= periodMax && magnitudes[i] > best) {
					best = magnitudes[i];
				}
			}
			return best;
		};
	}

	/** @returns {[{pValue:number, observed:number, nSurrogates:number, advice:string, reason:string}, boolean]} */
	export function surrogatetest(argsIN) {
		const empty = { pValue: NaN, observed: NaN, nSurrogates: 0, advice: '', reason: 'no input' };
		const xId = argsIN.xIN;
		const yId = argsIN.yIN;
		if (xId == null || xId === -1 || yId == null || yId === -1) return [empty, false];
		const xCol = getColumnById(xId);
		const yCol = getColumnById(yId);
		if (!xCol || !yCol) return [empty, false];

		// A `time` column's raw data is epoch MILLISECONDS. Reading it raw would
		// make dt 1.8e6, so `blockLengthHours` would round to a ONE-SAMPLE block —
		// i.e. a plain shuffle, the anti-conservative null this node exists to
		// avoid — and the period band would match nothing. Same idiom as Cosinor /
		// BinnedData / AverageProfile.
		const times = ((xCol.type === 'time' ? xCol.hoursSinceStart : xCol.getData()) ?? []).map(
			Number
		);
		const values = yCol.getData() ?? [];
		if (times.length < 8 || values.length < 8) {
			return [{ ...empty, reason: 'need at least 8 samples' }, false];
		}

		// Block length is given in HOURS but the bootstrap works in SAMPLES — the
		// units trap that silently makes a "24 h" block one sample long.
		const dt = times.length > 1 ? (times[times.length - 1] - times[0]) / (times.length - 1) : 1;
		const blockSamples =
			Number.isFinite(dt) && dt > 0
				? Math.max(1, Math.round((Number(argsIN.blockLengthHours) || 24) / dt))
				: 24;

		const periodMin = Number(argsIN.periodMin) || 20;
		const periodMax = Number(argsIN.periodMax) || 28;

		const res = surrogateTest(values, bandPowerStatistic(times, periodMin, periodMax), {
			method: argsIN.method ?? 'block',
			nSurrogates: Math.max(9, Math.floor(Number(argsIN.nSurrogates) || 199)),
			seed: Number(argsIN.seed) || 12345,
			blockLength: blockSamples
		});

		const advice = surrogateAdvice(argsIN.method ?? 'block', 'rhythmicity');

		writeOut(argsIN.out?.pvalue, [res.pValue]);
		writeOut(argsIN.out?.observed, [res.observed]);

		return [
			{
				pValue: res.pValue,
				observed: res.observed,
				nSurrogates: res.nSurrogates,
				advice,
				reason: res.reason
			},
			res.valid
		];
	}

	function writeOut(outId, values) {
		if (outId == null || outId < 0) return;
		core.rawData.set(outId, values);
		const outCol = /** @type {any} */ (getColumnById(outId));
		if (outCol) {
			outCol.data = outId;
			outCol.type = 'number';
			outCol.tableProcessGUId = crypto.randomUUID();
		}
	}

	export const definition = {
		displayName,
		defaults,
		func: surrogatetest,
		columnIdFields: { scalar: ['xIN', 'yIN'] },
		nodeSpec: {
			id: 'tableprocess.surrogatetest',
			inputs: [
				{ name: 'xIN', kind: 'column', cardinality: 'one' },
				{ name: 'yIN', kind: 'column', cardinality: 'one' }
			],
			outputs: [
				{ name: 'pvalue', kind: 'column', cardinality: 'one', metric: true },
				{ name: 'observed', kind: 'column', cardinality: 'one', metric: true }
			]
		}
	};
</script>

<script>
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';
	import ControlInput from '$lib/components/inputs/ControlInput.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import AttributeSelect from '$lib/components/inputs/AttributeSelect.svelte';
	import { onMount, untrack } from 'svelte';

	let { p = $bindable() } = $props();

	let mounted = $state(false);
	let result = $state({ pValue: NaN, observed: NaN, nSurrogates: 0, advice: '', reason: '' });

	let xCol = $derived(p.args.xIN >= 0 ? getColumnById(p.args.xIN) : null);
	let yCol = $derived(p.args.yIN >= 0 ? getColumnById(p.args.yIN) : null);
	let getHash = $derived.by(
		() =>
			(xCol?.getDataHash ?? '') +
			'|' +
			(yCol?.getDataHash ?? '') +
			'|' +
			[
				p.args.method,
				p.args.nSurrogates,
				p.args.seed,
				p.args.blockLengthHours,
				p.args.periodMin,
				p.args.periodMax
			].join(':')
	);
	// Backed by the session-lifetime compute memo, so a view switch (which destroys
	// and rebuilds this component) does not recompute unchanged inputs.
	const memo = nodeMemo(p, 'tableprocess');

	function recompute() {
		const [res, valid] = surrogatetest(p.args);
		p.args.valid = valid;
		result = res;
		// Record the result so a remount (a view switch rebuilds this component)
		// can restore it instead of running the analysis again.
		memo.hash = getHash;
		memo.payload = result;
	}

	$effect(() => {
		const h = getHash;
		if (!mounted) return;
		if (h !== memo.hash) {
			untrack(() => recompute());
			memo.hash = h;
		}
	});

	onMount(() => {
		if (!p.args.out) p.args.out = {};
		// Nothing changed since this node last ran? Put the previous result back
		// rather than recomputing: result lives only in this component, so it
		// was lost when the view switch destroyed the last instance.
		restoreOrCompute(
			memo,
			getHash,
			(cached) => {
				result = cached;
			},
			recompute
		);
		mounted = true;
	});

	const fmt = (v, dp = 4) => (Number.isFinite(v) ? Number(v).toFixed(dp) : '—');
</script>

<div class="section-row">
	<div class="tableProcess-label"><span>Input</span></div>
	<div class="control-input">
		<p>Time</p>
		<ColumnSelector bind:value={p.args.xIN} onChange={recompute} />
	</div>
	<div class="control-input">
		<p>Values</p>
		<ColumnSelector bind:value={p.args.yIN} onChange={recompute} />
	</div>
</div>

<div class="section-row">
	<div class="tableProcess-label"><span>Null model</span></div>
	<div class="control-input">
		<p>Surrogate</p>
		<AttributeSelect
			bind:value={p.args.method}
			options={SURROGATE_METHODS}
			optionsDisplay={[
				'Phase randomised',
				'AAFT',
				'Block bootstrap',
				'AR(1) red noise',
				'Shuffle (not recommended)'
			]}
		/>
	</div>
	{#if p.args.method === 'block'}
		<ControlInput label="Block length (hrs)">
			<NumberWithUnits bind:value={p.args.blockLengthHours} min="1" step="1" />
		</ControlInput>
	{/if}
</div>

{#if result.advice}
	<p class="tp-warn">{result.advice}</p>
{/if}

<div class="section-row">
	<div class="tableProcess-label"><span>Band</span></div>
	<div class="control-input-horizontal">
		<ControlInput label="Min period (hrs)">
			<NumberWithUnits bind:value={p.args.periodMin} min="0.1" step="1" />
		</ControlInput>
		<ControlInput label="Max period (hrs)">
			<NumberWithUnits bind:value={p.args.periodMax} min="0.1" step="1" />
		</ControlInput>
	</div>
</div>

<div class="section-row">
	<div class="tableProcess-label"><span>Resampling</span></div>
	<div class="control-input-horizontal">
		<ControlInput label="Surrogates">
			<NumberWithUnits bind:value={p.args.nSurrogates} min="9" step="100" />
		</ControlInput>
		<ControlInput label="Seed">
			<NumberWithUnits bind:value={p.args.seed} step="1" />
		</ControlInput>
	</div>
</div>

{#if p.args.valid}
	<details open>
		<summary class="section-details-summary">Result</summary>
		<p class="tp-result">
			p = {fmt(result.pValue)} &nbsp;·&nbsp; observed statistic = {fmt(result.observed, 3)}
			&nbsp;·&nbsp; {result.nSurrogates} surrogates
		</p>
		<p class="tp-hint">
			The smallest p this can report is 1/({result.nSurrogates} + 1) = {fmt(
				1 / (result.nSurrogates + 1)
			)}; raise the surrogate count for a finer resolution.
		</p>
	</details>
{:else if result.reason}
	<p class="tp-hint">{result.reason}</p>
{:else}
	<p>Wire a time column and a values column.</p>
{/if}

<style>
	.tp-hint,
	.tp-result {
		font-size: var(--font-size-small, 0.8rem);
		color: var(--color-text-muted);
		margin: var(--space-2) 0;
	}
	.tp-result {
		color: var(--text-color, inherit);
		font-variant-numeric: tabular-nums;
	}
	.tp-warn {
		font-size: var(--font-size-small, 0.8rem);
		background: var(--warn-bg, #fff6e0);
		border-left: 3px solid var(--warn-border, #e0a800);
		padding: var(--space-2);
		margin: var(--space-2) 0;
	}
</style>
