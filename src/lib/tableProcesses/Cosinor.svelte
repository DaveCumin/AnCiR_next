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

		if (
			xIN == undefined ||
			yIN == undefined ||
			Ncurves == undefined ||
			xIN == -1 ||
			yIN == -1 ||
			Ncurves < 1
		) {
			return [{ cosinorx: [], cosinory: [] }, false];
		}

		const t =
			getColumnById(xIN).type == 'time'
				? getColumnById(xIN).hoursSinceStart
				: getColumnById(xIN).getData();
		const y = getColumnById(yIN).getData();
		//remove NaNs
		const validIndices = t
			.map((t, i) => (isNaN(t) || isNaN(y[i]) ? -1 : i))
			.filter((i) => i !== -1);
		const tt = validIndices.map((i) => t[i]);
		const yy = validIndices.map((i) => y[i]);
		const fittedData = fitCosineCurves(tt, yy, Ncurves);
		console.log(fittedData);

		if (xOUT == -1 || yOUT == -1) {
		} else {
			getColumnById(xOUT).data = tt;
			getColumnById(xOUT).type = 'number';
			getColumnById(yOUT).data = fittedData.fitted;
			getColumnById(yOUT).type = 'number';
			const processHash = crypto.randomUUID();
			getColumnById(xOUT).tableProcessGUId = processHash;
			getColumnById(yOUT).tableProcessGUId = processHash;
		}

		return [{ t, fittedData: fittedData }, fittedData.fitted.length > 0];
	}
</script>

<script>
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';
	import { fitCosineCurves } from '$lib/utils/cosinor.js';
	import ColumnComponent from '$lib/core/Column.svelte';
	import Table from '$lib/components/plotbits/Table.svelte';

	import { getColumnById } from '$lib/core/Column.svelte';

	import { onMount } from 'svelte';

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
		if (lastHash === dataHash) {
			//do nothing
		} else {
			cosinorData = cosinor(p.args); // DO THE BUSINESS
			lastHash = getHash;
		}
	});
	//------------
	function getCosinor() {
		[cosinorData, p.args.valid] = cosinor(p.args);
		console.log($state.snapshot(cosinorData));
		console.log($state.snapshot(p.args));
	}
	onMount(() => {
		//needed to get the values when it first mounts
		getCosinor();
	});
</script>

<div class="tableProcess-container">
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
				<NumberWithUnits
					bind:value={p.args.Ncurves}
					onInput={() => getCosinor()}
					min="1"
					step="1"
				/>
			</div>
		</div>
	</div>

	<!-- Output Section -->
	<div class="section-row">
		<div class="tableProcess-label">
			<span>Output</span>
		</div>
		<div class="section-content">
			{#key cosinorData}
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
									{(2 * Math.PI * (1 / cosine.frequency)).toFixed(2)}
									{cosine.amplitude.toFixed(2)}*cos({cosine.frequency.toFixed(2)}*t + {cosine.phase.toFixed(
										2
									)})
								</p>
							</div>
						</div>
					{/each}
				{:else if p.args.valid}
					<p>Preview:</p>
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
			{/key}
		</div>
	</div>
</div>
