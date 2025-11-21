<script module>
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';

	export const cosinor_defaults = new Map([
		['xIN', { val: -1 }],
		['yIN', { val: -1 }],
		['Ncurves', { val: 0 }],
		['out', { cosinorx: { val: -1 }, cosinory: { val: -1 } }], //needed to set up the output columns
		['valid', { val: false }] //needed for the progress step logic
	]);

	export function cosinor(argsIN) {
		const xIN = argsIN.xIN;
		const yIN = argsIN.yIN;
		const Ncurves = argsIN.Ncurves;
		const xOUT = argsIN.out.cosinorx;
		const yOUT = argsIN.out.cosinory;

		let result = {
			t: [],
			fittedData: { fitted: [], parameters: { cosines: [] }, rmse: NaN }
		};
		let valid = false;

		if (xIN != -1 && yIN != -1 && Ncurves >= 1 && getColumnById(xIN) && getColumnById(yIN)) {
			const tCol = getColumnById(xIN);
			const yCol = getColumnById(yIN);

			const t = tCol.type === 'time' ? tCol.hoursSinceStart : tCol.getData();
			const y = yCol.getData();

			const validIndices = t
				.map((v, i) => (isNaN(v) || isNaN(y[i]) ? -1 : i))
				.filter((i) => i !== -1);

			const tt = validIndices.map((i) => t[i]);
			const yy = validIndices.map((i) => y[i]);

			const fittedData = fitCosineCurves(tt, yy, Ncurves);

			result = { t: tt, fittedData };
			valid = fittedData.fitted.length > 0;

			// Only write to output columns if they exist
			if (xOUT != -1 && yOUT != -1) {
				const xColOut = getColumnById(xOUT);
				const yColOut = getColumnById(yOUT);

				if (xColOut && yColOut) {
					xColOut.data = tt;
					xColOut.type = 'number';
					yColOut.data = fittedData.fitted;
					yColOut.type = 'number';

					const processHash = crypto.randomUUID();
					xColOut.tableProcessGUId = processHash;
					yColOut.tableProcessGUId = processHash;
				}
			}
		}

		return [result, valid];
	}
</script>

<script>
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';
	import { fitCosineCurves } from '$lib/utils/cosinor.js';
	import ColumnComponent from '$lib/core/Column.svelte';
	import Table from '$lib/components/plotbits/Table.svelte';

	import { getColumnById } from '$lib/core/Column.svelte';

	let { p = $bindable() } = $props();

	let cosinorData = $state();

	// for reactivity -----------
	let xIN_col = $derived.by(() => (p.args.xIN >= 0 ? getColumnById(p.args.xIN) : null));
	let yIN_col = $derived.by(() => (p.args.yIN >= 0 ? getColumnById(p.args.yIN) : null));
	let getHash = $derived.by(() => {
		let out = '';
		out += xIN_col?.getDataHash;
		out += yIN_col?.getDataHash;
		return out;
	});
	let lastHash = '';
	$effect(() => {
		const dataHash = getHash;
		if (lastHash !== dataHash) {
			[cosinorData, p.args.valid] = cosinor(p.args);
			lastHash = dataHash;
		}
	});
	//------------
	function getCosinor() {
		[cosinorData, p.args.valid] = cosinor(p.args);
	}
</script>

<!-- Input Section -->
<div class="section-row">
	<div class="tableProcess-label">
		<span>Input</span>
	</div>

	<div class="control-input-vertical">
		<div class="control-input">
			<p>X column</p>
			<ColumnSelector bind:value={p.args.xIN} onChange={(e) => getCosinor()} />
		</div>

		<div class="control-input-vertical">
			<div class="control-input">
				<p>Y column</p>
				<ColumnSelector
					bind:value={p.args.yIN}
					excludeColIds={[p.xIN]}
					onChange={(e) => getCosinor()}
				/>
			</div>
		</div>
	</div>
</div>

<!-- Process Section -->
<div class="section-row">
	<div class="tableProcess-label">
		<span>Cosinor parameters</span>
	</div>

	<div class="control-input-horizontal">
		<div class="control-input">
			<p>N cosine curves</p>
			<NumberWithUnits bind:value={p.args.Ncurves} onInput={() => getCosinor()} min="1" step="1" />
		</div>
	</div>
</div>

<!-- Output Section -->
<div class="section-row">
	<div class="tableProcess-label">
		<span>Output</span>
	</div>
	<div class="section-content">
		{#if p.args.valid && p.args.out.cosinorx != -1 && p.args.out.cosinory != -1}
			{@const xout = getColumnById(p.args.out.cosinorx)}
			<ColumnComponent col={xout} />
			{@const yout = getColumnById(p.args.out.cosinory)}
			<ColumnComponent col={yout} />
			<div class="control-input-horizontal">
				<div class="control-input">
					<p>RMSE: {cosinorData?.fittedData?.rmse.toFixed(3)}</p>
				</div>
			</div>
			{#each cosinorData?.fittedData?.parameters.cosines as cosine, i}
				<div class="control-input-horizontal">
					<div class="control-input">
						<p>
							Period: {(2 * Math.PI * (1 / cosine.frequency)).toFixed(2)}
						</p>

						<p>
							Equation: {cosine.amplitude.toFixed(2)}*cos({cosine.frequency.toFixed(2)}*t + {cosine.phase.toFixed(
								2
							)})
						</p>
					</div>
				</div>
			{/each}
		{:else if p.args.valid}
			<p>Preview:</p>
			<div class="control-input-horizontal">
				<div class="control-input">
					<p>RMSE: {cosinorData?.fittedData?.rmse.toFixed(3)}</p>
				</div>
			</div>
			{#each cosinorData?.fittedData?.parameters.cosines as cosine, i}
				<div class="control-input-horizontal">
					<div class="control-input">
						<p>
							Period: {(2 * Math.PI * (1 / cosine.frequency)).toFixed(2)}
						</p>
						<p>
							Equation: {cosine.amplitude.toFixed(2)}*cos({cosine.frequency.toFixed(2)}*t + {cosine.phase.toFixed(
								2
							)})
						</p>
					</div>
				</div>
			{/each}
			<div style="height:250px; overflow:auto;">
				<Table
					headers={['binned x', 'binned y']}
					data={[
						cosinorData.t.map((x) => x.toFixed(2)),
						cosinorData.fittedData.fitted.map((x) => x.toFixed(2))
					]}
				/>
			</div>
		{:else}
			<p>Need to have valid inputs to create columns.</p>
		{/if}
	</div>
</div>
