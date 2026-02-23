<script module>
	import { core } from '$lib/core/core.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import { fitCosineCurves, evaluateCosinorAtPoints } from '$lib/utils/cosinor.js';

	export const cosinor_defaults = new Map([
		['xIN', { val: -1 }],
		['yIN', { val: -1 }],
		['Ncurves', { val: 0 }],
		['outputX', { val: -1 }],
		['out', { cosinorx: { val: -1 }, cosinory: { val: -1 } }], //needed to set up the output columns
		['valid', { val: false }] //needed for the progress step logic
	]);

	export function cosinor(argsIN) {
		const xIN = argsIN.xIN;
		const yIN = argsIN.yIN;
		const Ncurves = argsIN.Ncurves;
		const outputXId = argsIN.outputX;
		const xOUT = argsIN.out.cosinorx;
		const yOUT = argsIN.out.cosinory;

		let result = {
			t: [],
			outputXData: null,
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

			// Get outputX data if specified
			let outputXData = null;
			if (outputXId != -1 && getColumnById(outputXId)) {
				const outputXCol = getColumnById(outputXId);
				outputXData =
					outputXCol.type === 'time' ? outputXCol.hoursSinceStart : outputXCol.getData();
				outputXData = outputXData.filter((v) => !isNaN(v));
			}

			const fittedData = fitCosineCurves(tt, yy, Ncurves);

			// Evaluate fitted model at outputX points after fitting (not during)
			const predicted = outputXData
				? evaluateCosinorAtPoints(fittedData.parameters, outputXData)
				: null;

			result = { t: tt, outputXData, fittedData, predicted };
			valid = fittedData.fitted.length > 0;

			// Only write to output columns if they exist
			if (xOUT != -1 && yOUT != -1) {
				const xColOut = getColumnById(xOUT);
				const yColOut = getColumnById(yOUT);

				if (xColOut && yColOut) {
					const xOutData = outputXData ?? tt;
					const yOutData = predicted ?? fittedData.fitted;

					core.rawData.set(xOUT, xOutData);
					xColOut.data = xOUT;
					xColOut.type = 'number';
					core.rawData.set(yOUT, yOutData);
					yColOut.data = yOUT;
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
	import ColumnComponent from '$lib/core/Column.svelte';
	import Table from '$lib/components/plotbits/Table.svelte';

	import { getColumnById } from '$lib/core/Column.svelte';
	import { onMount, untrack } from 'svelte';

	let { p = $bindable() } = $props();

	let cosinorData = $state();
	let showOutputX = $state(p.args.outputX !== -1);
	let mounted = $state(false);

	// for reactivity -----------
	let xIN_col = $derived.by(() => (p.args.xIN >= 0 ? getColumnById(p.args.xIN) : null));
	let yIN_col = $derived.by(() => (p.args.yIN >= 0 ? getColumnById(p.args.yIN) : null));
	let outputX_col = $derived.by(() => (p.args.outputX >= 0 ? getColumnById(p.args.outputX) : null));
	let getHash = $derived.by(() => {
		let out = '';
		out += xIN_col?.getDataHash;
		out += yIN_col?.getDataHash;
		out += outputX_col?.getDataHash;
		return out;
	});
	let lastHash = '';
	$effect(() => {
		const dataHash = getHash;
		if (!mounted) return;
		if (lastHash !== dataHash) {
			untrack(() => {
				[cosinorData, p.args.valid] = cosinor(p.args);
			});
			lastHash = dataHash;
		}
	});
	//------------
	function getCosinor() {
		[cosinorData, p.args.valid] = cosinor(p.args);
	}

	onMount(() => {
		//If data already exists (e.g. imported from JSON), use it instead of regenerating
		const xKey = p.args.out.cosinorx;
		const yKey = p.args.out.cosinory;
		if (xKey >= 0 && yKey >= 0 && core.rawData.has(xKey) && core.rawData.get(xKey).length > 0) {
			cosinorData = {
				t: core.rawData.get(xKey),
				outputXData: null,
				fittedData: { fitted: core.rawData.get(yKey), parameters: { cosines: [] }, rmse: NaN }
			};
			p.args.valid = true;
			lastHash = getHash; // prevent $effect from recalculating
		}
		mounted = true;
	});

	function toggleOutputX(checked) {
		if (!checked) {
			p.args.outputX = -1;
			getCosinor();
		}
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
				<ColumnSelector bind:value={p.args.outputX} onChange={(e) => getCosinor()} />
			</div>
		</div>
	{/if}
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
					headers={['x', cosinorData.outputXData ? 'predicted y' : 'fitted y']}
					data={[
						(cosinorData.outputXData ?? cosinorData.t).map((x) => x.toFixed(2)),
						(cosinorData.predicted ?? cosinorData.fittedData.fitted).map((x) => x.toFixed(2))
					]}
				/>
			</div>
		{:else}
			<p>Need to have valid inputs to create columns.</p>
		{/if}
	</div>
</div>
