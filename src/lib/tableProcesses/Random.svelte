<script module>
	import { core } from '$lib/core/core.svelte';
	import minstd from '@stdlib/random-base-minstd-shuffle';
	import uniform from '@stdlib/random-base-uniform';
	import normal from '@stdlib/random-base-normal';
	import exponential from '@stdlib/random-base-exponential';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';

	const displayName = 'Random';
	const MINSTD_MAX = 2147483646;

	/**
	 * @typedef {Object} RandomArgs
	 * @property {number} N
	 * @property {number} offset
	 * @property {number} multiply
	 * @property {number} seed
	 * @property {'uniform'|'gaussian'|'exponential'} distribution
	 * @property {{result:number}} out
	 */
	const defaults = new Map([
		['offset', { val: 0 }],
		['multiply', { val: 10 }],
		['N', { val: 10 }],
		['seed', { val: 12345 }],
		['distribution', { val: 'uniform' }],
		['out', { result: { val: -1 } }], //needed to set upu the output columns
		['valid', { val: false }] //needed for the progress step logic
	]);

	/** @param {number | string | undefined} seed */
	function normalizeSeed(seed) {
		const numericSeed = Math.trunc(Number(seed));
		if (!Number.isFinite(numericSeed)) {
			return 1;
		}
		return ((((numericSeed - 1) % MINSTD_MAX) + MINSTD_MAX) % MINSTD_MAX) + 1;
	}

	/** @param {RandomArgs} argsIN */
	function makeDistributionGenerator(argsIN) {
		const seed = normalizeSeed(argsIN.seed);
		const prng = /** @type {{ normalized: () => number }} */ (
			/** @type {unknown} */ (minstd.factory({ seed }))
		);
		const distribution = argsIN.distribution ?? 'uniform';

		if (distribution === 'gaussian') {
			const sigma = Math.abs(Number(argsIN.multiply));
			if (!Number.isFinite(sigma) || sigma === 0) {
				const fixed = Number(argsIN.offset);
				return () => fixed;
			}
			return normal.factory(Number(argsIN.offset), sigma, { prng: prng.normalized });
		}

		if (distribution === 'exponential') {
			const mean = Math.abs(Number(argsIN.multiply));
			if (!Number.isFinite(mean) || mean === 0) {
				const fixed = Number(argsIN.offset);
				return () => fixed;
			}
			const randExp = exponential.factory(1 / mean, { prng: prng.normalized });
			const base = Number(argsIN.offset);
			return () => base + randExp();
		}

		const randUnit = uniform.factory(0, 1, { prng: prng.normalized });
		const base = Number(argsIN.offset);
		const scale = Number(argsIN.multiply);
		return () => base + randUnit() * scale;
	}

	/** @param {RandomArgs} argsIN */
	export function random(argsIN) {
		let result = [];
		const n = Math.max(0, Math.trunc(Number(argsIN.N) || 0));
		const generator = makeDistributionGenerator(argsIN);
		for (let i = 0; i < n; i++) {
			result.push(Number(generator().toFixed(2)));
		}
		if (!(argsIN.out.result == -1 || !argsIN.out.result)) {
			core.rawData.set(argsIN.out.result, result);
			const outCol = /** @type {any} */ (getColumnById(argsIN.out.result));
			if (outCol) {
				outCol.data = argsIN.out.result;
				outCol.type = typeof result[0] != 'number' ? 'category' : 'number';

				const processHash = crypto.randomUUID();
				outCol.tableProcessGUId = processHash;
			}
		}

		return [result, result.length > 0];
	}

	export const definition = {
		displayName,
		defaults,
		func: random,
		columnIdFields: {},
		nodeSpec: {
			id: 'tableprocess.random',
			inputs: [],
			outputs: [{ name: 'result', kind: 'column', cardinality: 'one' }]
		}
	};
</script>

<script>
	import ColumnComponent from '$lib/core/Column.svelte';
	import Table from '$lib/components/plotbits/Table.svelte';

	import { getColumnById } from '$lib/core/Column.svelte';
	import { onMount } from 'svelte';

	let { p = $bindable() } = $props();

	let result = $state();
	let previewStart = $state(1);
	let multiplyLabel = $derived(
		p.args.distribution === 'gaussian'
			? 'Std dev'
			: p.args.distribution === 'exponential'
				? 'Mean'
				: 'Multiply'
	);
	let offsetLabel = $derived(p.args.distribution === 'gaussian' ? 'Mean' : 'Offset');
	function doRandom() {
		previewStart = 1;
		[result, p.args.valid] = random(p.args);
	}
	onMount(() => {
		if (!p.args.distribution) p.args.distribution = 'uniform';
		if (p.args.seed === undefined) p.args.seed = 12345;
		//If data already exists (e.g. imported from JSON), use it instead of regenerating
		const outKey = p.args.out.result;
		if (outKey >= 0 && core.rawData.has(outKey) && core.rawData.get(outKey).length > 0) {
			result = core.rawData.get(outKey);
			p.args.valid = true;
		} else {
			doRandom();
		}
	});
</script>

<div class="section-row">
	<div class="tableProcess-label">
		<span>Random settings</span>
	</div>

	<div class="control-input-vertical">
		<div class="control-input">
			<p>Distribution</p>
			<select bind:value={p.args.distribution} onchange={doRandom}>
				<option value="uniform">Uniform</option>
				<option value="gaussian">Gaussian</option>
				<option value="exponential">Exponential</option>
			</select>
		</div>
		<div class="control-input">
			<p>Seed</p>
			<NumberWithUnits bind:value={p.args.seed} onInput={doRandom} step={1} />
		</div>
		<div class="control-input">
			<p>N</p>
			<NumberWithUnits bind:value={p.args.N} onInput={doRandom} />
		</div>
		<div class="control-input">
			<p>{offsetLabel}</p>
			<NumberWithUnits bind:value={p.args.offset} onInput={doRandom} />
		</div>
		<div class="control-input">
			<p>{multiplyLabel}</p>
			<NumberWithUnits bind:value={p.args.multiply} onInput={doRandom} />
		</div>
	</div>
</div>

{#if p.args.valid && p.args.out.result == -1}
	{@const totalRows = result.length}
	<p>Preview:</p>
	<Table headers={['Result']} data={[result.slice(previewStart - 1, previewStart + 5)]} />
	<p>
		Row <NumberWithUnits
			min={1}
			max={Math.max(1, totalRows - 5)}
			step={1}
			bind:value={previewStart}
		/> to {Math.min(previewStart + 5, totalRows)} of {totalRows}
	</p>
{:else if p.args.out.result > 0}
	<details open>
		<summary class="section-details-summary">Output</summary>
		<ColumnComponent col={getColumnById(p.args.out.result)} />
	</details>
{:else}
	<p>Need to have valid inputs to create columns.</p>
{/if}
