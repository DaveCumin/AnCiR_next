<script module>
	import { core } from '$lib/core/core.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	export const binneddata_displayName = 'Bin Data';
	export const binneddata_defaults = new Map([
		['xIN', { val: -1 }],
		['yIN', { val: [] }],
		['binSize', { val: 0.25 }],
		['binStart', { val: 0 }],
		['stepSize', { val: 0.25 }], //null = use binSize as step
		['diffStep', { val: false }],
		['aggFunction', { val: 'mean' }], // mean | median | min | max | stddev
		['out', { binnedx: { val: -1 } }],
		['valid', { val: false }],
		['forcollected', { val: true }],
		['collectedType', { val: 'bin' }]
	]);

	export function binneddata(argsIN, differentstepsize) {
		const xIN = argsIN.xIN;
		// Backward compat: accept single number or array
		let yINs = argsIN.yIN;
		if (!Array.isArray(yINs)) yINs = yINs != null && yINs !== -1 ? [yINs] : [];
		const binSize = argsIN.binSize;
		const binStart = argsIN.binStart;
		const stepSize = differentstepsize ? argsIN.stepSize : binSize;
		const aggFunction = argsIN.aggFunction || 'mean';
		const xOUT = argsIN.out.binnedx;

		if (
			xIN == undefined ||
			binSize == undefined ||
			binStart == undefined ||
			xIN == -1 ||
			yINs.length === 0 ||
			binSize <= 0
		) {
			return [{ bins: [], y_results: {} }, false];
		}

		const xInCol = getColumnById(xIN);
		if (!xInCol) return [{ bins: [], y_results: {} }, false];

		const xData = xInCol.type === 'time' ? xInCol.hoursSinceStart : xInCol.getData();

		const result = { bins: [], y_results: {} };
		let anyValid = false;

		for (const yId of yINs) {
			if (yId == null || yId === -1) continue;
			const yCol = getColumnById(yId);
			if (!yCol) continue;
			const yData = yCol.getData();

			const theBinnedData = binData(xData, yData, binSize, binStart, stepSize, aggFunction);

			if (theBinnedData.bins.length > 0) {
				// Use first valid Y's bins as the shared x output
				if (result.bins.length === 0) result.bins = theBinnedData.bins;
				result.y_results[yId] = theBinnedData.y_out;
				anyValid = true;
			}
		}

		if (anyValid && xOUT !== -1) {
			const processHash = crypto.randomUUID();

			core.rawData.set(xOUT, result.bins);
			getColumnById(xOUT).data = xOUT;
			getColumnById(xOUT).type = 'bin';
			getColumnById(xOUT).binWidth = binSize;
			getColumnById(xOUT).binStep = stepSize;
			getColumnById(xOUT).aggFunction = aggFunction;
			if (xInCol.type === 'time') {
				const xRawData = xInCol.getData();
				if (xRawData?.length > 0) {
					getColumnById(xOUT).originTime_ms = xRawData[0];
				}
			}
			getColumnById(xOUT).tableProcessGUId = processHash;

			for (const yId of yINs) {
				const outKey = 'binnedy_' + yId;
				const yOUT = argsIN.out[outKey];
				if (yOUT != null && yOUT !== -1 && result.y_results[yId]) {
					core.rawData.set(yOUT, result.y_results[yId]);
					getColumnById(yOUT).data = yOUT;
					getColumnById(yOUT).type = 'number';
					getColumnById(yOUT).tableProcessGUId = processHash;
				}
			}
		}

		return [result, anyValid];
	}
</script>

<script>
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';
	import { binData } from '$lib/components/plotbits/helpers/wrangleData.js';
	import ColumnComponent from '$lib/core/Column.svelte';
	import Table from '$lib/components/plotbits/Table.svelte';
	import { Column, getColumnById, removeColumn } from '$lib/core/Column.svelte';
	import { pushObj } from '$lib/core/core.svelte.js';
	import { onMount, untrack } from 'svelte';

	let { p = $bindable(), hideInputs = false } = $props();

	// --- Backward compat ---
	// Convert legacy single yIN number to array
	if (typeof p.args.yIN === 'number') {
		p.args.yIN = p.args.yIN !== -1 ? [p.args.yIN] : [];
	}
	// Migrate old 'binnedy' output key to per-Y format ('binnedy_{yId}')
	if (p.args.out?.binnedy != null) {
		if (p.args.out.binnedy >= 0 && p.args.yIN.length > 0) {
			p.args.out['binnedy_' + p.args.yIN[0]] = p.args.out.binnedy;
		}
		delete p.args.out.binnedy;
	}
	// Migrate: ensure diffStep exists
	if (p.args.diffStep === undefined) p.args.diffStep = false;

	let binnedData = $state();
	let previewStart = $state(1);
	let mounted = $state(false);

	// Track previous Y IDs to detect what changed (non-reactive)
	let prevYIds = [...(p.args.yIN ?? [])].map(Number);

	// Reactivity — mirrors original pattern
	let xIN_col = $derived.by(() => (p.args.xIN >= 0 ? getColumnById(p.args.xIN) : null));
	let getHash = $derived.by(() => {
		let h = '';
		h += xIN_col?.getDataHash ?? '';
		for (const yId of p.args.yIN ?? []) {
			const col = yId >= 0 ? getColumnById(yId) : null;
			h += col?.getDataHash ?? '';
		}
		h += p.args.binSize + p.args.binStart + (p.args.stepSize ?? '') + p.args.aggFunction;
		return h;
	});
	let lastHash = '';

	// Single data effect — mirrors original pattern
	// Only recomputes when data or params change; does NOT create/remove columns
	$effect(() => {
		const dataHash = getHash;
		if (!mounted) return;
		if (dataHash !== lastHash) {
			untrack(() => {
				previewStart = 1;
				[binnedData, p.args.valid] = binneddata(p.args, p.args.diffStep);
			});
			lastHash = dataHash;
		}
	});

	// Called when Y selection changes in the multi-select.
	// bind:value has already updated p.args.yIN, so we compare against prevYIds.
	function onYSelectionChange() {
		const newIds = (p.args.yIN ?? []).map(Number).filter((id) => id >= 0);
		const newSet = new Set(newIds);
		const oldSet = new Set(prevYIds);

		// Skip if no actual change
		if (newIds.length === prevYIds.length && newIds.every((id) => oldSet.has(id))) return;

		// Remove output columns for deselected Y inputs
		for (const oldId of prevYIds) {
			if (!newSet.has(oldId)) {
				const outKey = 'binnedy_' + oldId;
				const outColId = p.args.out[outKey];
				if (outColId != null && outColId >= 0) {
					core.rawData.delete(outColId);
					removeColumn(outColId);
				}
				delete p.args.out[outKey];
			}
		}

		// Create output columns for newly selected Y inputs
		for (const newId of newIds) {
			const outKey = 'binnedy_' + newId;
			if (p.args.out[outKey] == null || p.args.out[outKey] === -1) {
				if (p.parent) {
					const srcName = getColumnById(newId)?.name ?? String(newId);
					const yCol = new Column({});
					yCol.name = 'bin_' + srcName;
					pushObj(yCol);
					p.parent.columnRefs = [yCol.id, ...p.parent.columnRefs];
					p.args.out[outKey] = yCol.id;
				}
			}
		}

		// Update tracking
		prevYIds = [...newIds];

		// Recompute
		getBinnedData();
	}

	function getBinnedData() {
		previewStart = 1;
		[binnedData, p.args.valid] = binneddata(p.args, p.args.diffStep);
		lastHash = getHash;
	}

	// Exclude own output column IDs from the Y selector
	let yExcludeIds = $derived.by(() => {
		if (hideInputs) return [];
		const ids = [p.args.xIN];
		if (p.args.out.binnedx >= 0) ids.push(p.args.out.binnedx);
		for (const key of Object.keys(p.args.out)) {
			if (key.startsWith('binnedy_') && p.args.out[key] >= 0) {
				ids.push(p.args.out[key]);
			}
		}
		return ids;
	});

	// Reconcile output columns when yIN changes externally (e.g. from parent in collected mode)
	$effect(() => {
		p.args.yIN; // read to track as reactive dependency
		if (!mounted) return;
		untrack(() => onYSelectionChange());
	});

	onMount(() => {
		if (!p.args.out) p.args.out = {};
		// Ensure X output column exists (created by TableProcess.svelte in standalone;
		// must be created here in collected mode)
		if ((p.args.out.binnedx == null || p.args.out.binnedx < 0) && p.parent) {
			const xCol = new Column({});
			xCol.name = 'binnedx_' + p.id;
			pushObj(xCol);
			p.parent.columnRefs = [xCol.id, ...p.parent.columnRefs];
			p.args.out.binnedx = xCol.id;
		}
		// Create output columns for any Y inputs that don't have them yet
		// (e.g. when the process was created programmatically with yIN pre-set)
		let needsCompute = false;
		for (const yId of p.args.yIN ?? []) {
			const outKey = 'binnedy_' + yId;
			if (p.args.out[outKey] == null || p.args.out[outKey] === -1) {
				if (p.parent) {
					const srcName = getColumnById(Number(yId))?.name ?? String(yId);
					const yCol = new Column({});
					yCol.name = 'bin_' + srcName;
					pushObj(yCol);
					p.parent.columnRefs = [yCol.id, ...p.parent.columnRefs];
					p.args.out[outKey] = yCol.id;
					needsCompute = true;
				}
			}
		}
		prevYIds = [...(p.args.yIN ?? [])].map(Number);

		if (needsCompute) {
			getBinnedData();
		} else {
			const xKey = p.args.out.binnedx;
			if (xKey >= 0 && core.rawData.has(xKey) && core.rawData.get(xKey).length > 0) {
				const y_results = {};
				for (const yId of p.args.yIN ?? []) {
					const outKey = 'binnedy_' + yId;
					const yOutId = p.args.out[outKey];
					if (yOutId >= 0 && core.rawData.has(yOutId)) {
						y_results[yId] = core.rawData.get(yOutId);
					}
				}
				binnedData = { bins: core.rawData.get(xKey), y_results };
				p.args.valid = true;
				lastHash = getHash;
			}
		}
		mounted = true;
	});
</script>

<!-- Input Section -->
{#if !hideInputs}
	<div class="section-row">
		<div class="tableProcess-label"><span>Input</span></div>
		<div class="control-input-vertical">
			<div class="control-input">
				<p>X column</p>
				<ColumnSelector bind:value={p.args.xIN} onChange={getBinnedData} />
			</div>
			<div class="control-input">
				<p>Y columns</p>
				<ColumnSelector
					bind:value={p.args.yIN}
					excludeColIds={yExcludeIds}
					multiple={true}
					onChange={onYSelectionChange}
				/>
			</div>
		</div>
	</div>
{/if}

<!-- Bin Parameters -->
<div class="section-row">
	<div class="tableProcess-label"><span>Bin parameters</span></div>
	<div class="control-input-horizontal">
		<div class="control-input">
			<p>Bin size (hrs)</p>
			<NumberWithUnits bind:value={p.args.binSize} onInput={getBinnedData} min="0.01" step="0.01" />
		</div>
		<div class="control-input">
			<p>Bin start (hr)</p>
			<NumberWithUnits bind:value={p.args.binStart} onInput={getBinnedData} />
		</div>
	</div>

	<p>Different step size</p>
	<input
		type="checkbox"
		bind:checked={p.args.diffStep}
		onchange={() => {
			p.args.stepSize = p.args.diffStep ? p.args.binSize : null;
			getBinnedData();
		}}
	/>

	<div class="control-input-horizontal">
		{#if p.args.diffStep}
			<div class="control-input">
				<p>Step size (hrs)</p>

				<NumberWithUnits
					bind:value={p.args.stepSize}
					onInput={getBinnedData}
					min="0.01"
					step="0.01"
				/>
			</div>
		{/if}
		<div class="control-input">
			<p>Function</p>
			<select bind:value={p.args.aggFunction} onchange={getBinnedData}>
				<option value="mean">Mean</option>
				<option value="median">Median</option>
				<option value="min">Minimum</option>
				<option value="max">Maximum</option>
				<option value="stddev">Std Dev</option>
			</select>
		</div>
	</div>
</div>

<!-- Output / Preview -->
<div class="section-row">
	<div class="section-content">
		{#key binnedData}
			{#if p.args.valid && p.args.out.binnedx != -1}
				{@const xout = getColumnById(p.args.out.binnedx)}
				<div class="tableProcess-label"><span>Output</span></div>
				<div class="tp-outputs">
					<div class="tp-output-row">
						<span class="tp-output-label">{getColumnById(p.args.xIN)?.name ?? 'x'} (shared)</span>
						<ColumnComponent col={xout} />
					</div>
					{#each p.args.yIN ?? [] as yId}
						{@const outKey = 'binnedy_' + yId}
						{@const yOutId = p.args.out[outKey]}
						{#if yOutId >= 0}
							{@const yout = getColumnById(yOutId)}
							{#if yout}
								<div class="tp-output-row">
									<span class="tp-output-label">{getColumnById(Number(yId))?.name ?? yId}</span>
									<ColumnComponent col={yout} />
								</div>
							{/if}
						{/if}
					{/each}
				</div>
			{:else if p.args.valid && binnedData?.bins?.length}
				{@const totalRows = binnedData.bins.length}
				{@const yIds = Object.keys(binnedData.y_results)}
				<p>Preview ({p.args.aggFunction}{p.args.stepSize ? `, step=${p.args.stepSize}` : ''}):</p>
				<Table
					headers={[
						'binned x (center)',
						...yIds.map((id) => 'binned y (' + (getColumnById(Number(id))?.name ?? id) + ')')
					]}
					data={[
						binnedData.bins
							.slice(previewStart - 1, previewStart + 5)
							.map((x) => (x + p.args.stepSize / 2).toFixed(4)),
						...yIds.map((id) =>
							binnedData.y_results[id]
								.slice(previewStart - 1, previewStart + 5)
								.map((y) => y.toFixed(4))
						)
					]}
				/>
				<p>
					Row <NumberWithUnits
						min={1}
						max={Math.max(1, totalRows - 5)}
						step={1}
						bind:value={previewStart}
					/> to {Math.min(previewStart + 5, totalRows)} of {totalRows}
				</p>
			{:else}
				<p>Select valid input columns and parameters to see preview.</p>
			{/if}
		{/key}
	</div>
</div>

