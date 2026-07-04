<script module>
	import { normalizeYInputs, migrateLegacyYIN } from '$lib/tableProcesses/tpArgHelpers.js';
	import { writeOutputColumn, writeXOutput } from '$lib/tableProcesses/outputColumns.js';
	import { core } from '$lib/core/core.svelte';
	import { min as arrayMin, max as arrayMax } from '$lib/components/plotbits/helpers/wrangleData.js';
	import { interpolate, knownPoints, makeGrid, isFiniteNum } from '$lib/utils/interpolate.js';

	const displayName = 'Interpolate';
	const defaults = new Map([
		['xIN', { val: -1 }],
		['yIN', { val: [] }],
		['mode', { val: 'fill' }], // 'fill' (keep original x, fill gaps) | 'resample' (new grid)
		['method', { val: 'linear' }], // 'linear' | 'nearest' | 'spline'
		['step', { val: 1 }], // resample grid spacing (x units; hours when x is time)
		['start', { val: null }], // resample grid start (null = min of data)
		['end', { val: null }], // resample grid end (null = max of data)
		['out', { interpx: { val: -1 } }],
		['valid', { val: false }],
		['forcollected', { val: true }],
		['collectedType', { val: 'interpolate' }]
	]);

	export const definition = {
		displayName,
		defaults,
		func: interpolatedata,
		columnIdFields: { scalar: ['xIN'], array: ['yIN'] },
		xOutKey: 'interpx',
		yOutKeyPrefix: 'interpy_',
		nodeSpec: {
			id: 'tableprocess.interpolate',
			inputs: [
				{ name: 'xIN', kind: 'column', cardinality: 'one' },
				{ name: 'yIN', kind: 'column', cardinality: 'many' }
			],
			outputs: [
				{ name: 'interpx', kind: 'column', cardinality: 'one' },
				{ name: 'interpy_*', kind: 'column', cardinality: 'many', dynamicPrefix: 'interpy_' }
			]
		}
	};

	/**
	 * Interpolate each Y over X. Two modes:
	 *  - 'fill': keep the original X points, fill missing/NaN Y by interpolating
	 *    over the finite neighbours (output length = input length).
	 *  - 'resample': build an evenly-spaced X grid (step, optional start/end) and
	 *    interpolate Y onto it.
	 * Returns [{ x, y_results, mode }, valid].
	 */
	export function interpolatedata(argsIN) {
		const xIN = argsIN.xIN;
		const yINs = normalizeYInputs(argsIN.yIN);
		const mode = argsIN.mode === 'resample' ? 'resample' : 'fill';
		const method = ['linear', 'nearest', 'spline'].includes(argsIN.method)
			? argsIN.method
			: 'linear';
		const xOUT = argsIN.out?.interpx;

		const empty = () => ({ x: [], y_results: {}, mode });
		if (xIN == undefined || xIN === -1 || yINs.length === 0) return [empty(), false];

		const xInCol = getColumnById(xIN);
		if (!xInCol) return [empty(), false];

		const isTime = xInCol.type === 'time';
		// Interpolation happens in numeric units: hours-since-start for a time X,
		// otherwise the raw values. The OUTPUT x is converted back for display.
		const xForInterp = isTime ? xInCol.hoursSinceStart : xInCol.getData();
		const xRaw = xInCol.getData();
		const baseline = isTime ? (arrayMin(xRaw) ?? 0) : 0;

		// Query points (in xForInterp units) + the display-x that pairs with them.
		let queryX; // numeric grid used for interpolation
		let outXDisplay; // what the interpx column stores (ms for time, else numeric)
		if (mode === 'resample') {
			const finite = xForInterp.filter(isFiniteNum);
			if (finite.length === 0) return [empty(), false];
			const start = isFiniteNum(argsIN.start) ? argsIN.start : (arrayMin(finite) ?? 0);
			const end = isFiniteNum(argsIN.end) ? argsIN.end : (arrayMax(finite) ?? 0);
			const step = Number(argsIN.step);
			queryX = makeGrid(start, end, step);
			if (queryX.length === 0) return [empty(), false];
			outXDisplay = isTime ? queryX.map((h) => baseline + h * 3600000) : queryX.slice();
		} else {
			// fill: keep every original row so the result lines up 1:1 with input X.
			queryX = xForInterp;
			outXDisplay = xRaw.slice();
		}

		const result = { x: outXDisplay, y_results: {}, mode };
		let anyValid = false;
		for (const yId of yINs) {
			if (yId == null || yId === -1) continue;
			const yCol = getColumnById(yId);
			if (!yCol) continue;
			// Need at least one finite (x,y) pair to interpolate from.
			const { xs } = knownPoints(xForInterp, yCol.getData());
			if (xs.length === 0) continue;
			result.y_results[yId] = interpolate(xForInterp, yCol.getData(), queryX, method);
			anyValid = true;
		}

		if (anyValid && xOUT != null && xOUT !== -1) {
			const processHash = crypto.randomUUID();
			// outXDisplay is already ms-converted for time inputs, so write it as-is
			// (not via writeXOutput, which would re-convert) and stamp originTime_ms.
			if (
				writeOutputColumn(xOUT, outXDisplay, {
					type: isTime ? 'time' : 'number',
					timeFormat: isTime ? null : undefined,
					processHash
				})
			) {
				getColumnById(xOUT).originTime_ms = isTime ? baseline : null;
			}
			for (const yId of yINs) {
				const yOUT = argsIN.out['interpy_' + yId];
				if (yOUT != null && yOUT !== -1 && result.y_results[yId]) {
					writeOutputColumn(yOUT, result.y_results[yId], { processHash });
				}
			}
		}

		return [result, anyValid];
	}
</script>

<script>
	// @ts-nocheck
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';
	import ControlInput from '$lib/components/inputs/ControlInput.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import ColumnComponent from '$lib/core/Column.svelte';
	import { getColumnById } from '$lib/core/Column.svelte';
	import { useMultiYTP } from '$lib/tableProcesses/useMultiYTP.svelte.js';
	import { formatDateTime } from '$lib/utils/time/displayTime.js';
	import { onMount, untrack } from 'svelte';

	let { p = $bindable(), hideInputs = false } = $props();

	// Backward compat: single yIN → array.
	migrateLegacyYIN(p.args);

	let result = $state();
	let previewStart = $state(1);
	let mounted = $state(false);

	const { syncYColumns, initYColumns } = useMultiYTP(p, 'interpy_', 'interp_');

	let xIN_col = $derived.by(() => (p.args.xIN >= 0 ? getColumnById(p.args.xIN) : null));

	let getHash = $derived.by(() => {
		let h = '';
		h += xIN_col?.getDataHash ?? '';
		for (const yId of p.args.yIN ?? []) {
			h += (yId >= 0 ? getColumnById(yId)?.getDataHash : '') ?? '';
		}
		h += '|' + p.args.mode + '|' + p.args.method;
		h += '|' + p.args.step + '|' + p.args.start + '|' + p.args.end;
		return h;
	});
	let lastHash = '';

	$effect(() => {
		const dataHash = getHash;
		if (!mounted) return;
		if (dataHash !== lastHash) {
			untrack(() => {
				previewStart = 1;
				[result, p.args.valid] = interpolatedata(p.args);
			});
			lastHash = dataHash;
		}
	});

	function recompute() {
		previewStart = 1;
		[result, p.args.valid] = interpolatedata(p.args);
		lastHash = getHash;
	}

	function onYSelectionChange() {
		if (syncYColumns()) recompute();
	}

	let ownOutputIds = $derived.by(() =>
		Object.values(p.args.out ?? {}).filter((v) => typeof v === 'number' && v >= 0)
	);
	let yExcludeIds = $derived.by(() => (hideInputs ? [] : [p.args.xIN, ...ownOutputIds]));

	$effect(() => {
		p.args.yIN; // track
		if (!mounted) return;
		untrack(() => onYSelectionChange());
	});

	onMount(() => {
		if (!p.args.out) p.args.out = {};
		const needsCompute = initYColumns();
		if (needsCompute) {
			recompute();
		} else {
			// Reload existing results from rawData if present.
			const xKey = p.args.out.interpx;
			if (xKey >= 0 && core.rawData.has(xKey) && core.rawData.get(xKey).length > 0) {
				const y_results = {};
				for (const yId of p.args.yIN ?? []) {
					const yOutId = p.args.out['interpy_' + yId];
					if (yOutId >= 0 && core.rawData.has(yOutId)) y_results[yId] = core.rawData.get(yOutId);
				}
				result = { x: core.rawData.get(xKey), y_results, mode: p.args.mode };
				p.args.valid = true;
			}
		}
		mounted = true;
	});

	const isTimeX = $derived(xIN_col?.type === 'time');
	function fmt(v, isX) {
		if (v == null || (typeof v === 'number' && !Number.isFinite(v))) return '—';
		if (isX && isTimeX) return formatDateTime(v);
		const n = Number(v);
		return Number.isFinite(n) ? (Math.round(n * 1000) / 1000).toString() : String(v);
	}

	// Preview table (first rows of interpx + each interpy).
	let previewRows = $derived.by(() => {
		if (!result?.x?.length) return { headers: [], rows: [] };
		const yIds = Object.keys(result.y_results ?? {});
		const headers = ['x', ...yIds.map((id) => getColumnById(Number(id))?.name ?? id)];
		const rows = [];
		for (let i = previewStart - 1; i < Math.min(previewStart - 1 + 8, result.x.length); i++) {
			rows.push([fmt(result.x[i], true), ...yIds.map((id) => fmt(result.y_results[id]?.[i], false))]);
		}
		return { headers, rows };
	});
</script>

{#if !hideInputs}
	<div class="section-row">
		<div class="tableProcess-label"><span>Input</span></div>
		<div class="control-input-vertical">
			<div class="control-input">
				<p>X column</p>
				<ColumnSelector bind:value={p.args.xIN} />
			</div>
			<div class="control-input">
				<p>Y columns</p>
				<ColumnSelector bind:value={p.args.yIN} excludeColIds={yExcludeIds} multiple={true} />
			</div>
		</div>
	</div>
{/if}

<div class="section-row">
	<div class="control-input-vertical">
		<ControlInput label="Mode">
			<select bind:value={p.args.mode} onchange={recompute}>
				<option value="fill">Fill gaps (keep times)</option>
				<option value="resample">Resample (new grid)</option>
			</select>
		</ControlInput>

		<ControlInput label="Method">
			<select bind:value={p.args.method} onchange={recompute}>
				<option value="linear">Linear</option>
				<option value="nearest">Nearest</option>
				<option value="spline">Cubic spline</option>
			</select>
		</ControlInput>

		{#if p.args.mode === 'resample'}
			<div class="control-input-horizontal">
				<ControlInput label="Step">
					<NumberWithUnits step="0.1" bind:value={p.args.step} onInput={recompute} />
				</ControlInput>
			</div>
			<p class="hint">Grid spans the data range (min→max of X). Step is in X units{' '}
				{xIN_col?.type === 'time' ? '(hours)' : ''}.</p>
		{/if}
	</div>
</div>

<div class="div-line"></div>

{#if p.args.valid && result?.x?.length && previewRows.headers.length}
	<div class="section-row">
		<div class="tableProcess-label"><span>Preview ({result.mode})</span></div>
		<table class="interp-preview">
			<thead>
				<tr>{#each previewRows.headers as h}<th>{h}</th>{/each}</tr>
			</thead>
			<tbody>
				{#each previewRows.rows as row}
					<tr>{#each row as cell}<td>{cell}</td>{/each}</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<!-- Output columns (interpx + each interpy) -->
<div class="section-row">
	<div class="tableProcess-label"><span>Output</span></div>
	<div class="control-input-vertical">
		{#if p.args.out?.interpx >= 0}
			{@const xcol = getColumnById(p.args.out.interpx)}
			{#if xcol}<ColumnComponent col={xcol} />{/if}
		{/if}
		{#each p.args.yIN ?? [] as yId}
			{@const outId = p.args.out?.['interpy_' + yId]}
			{#if outId >= 0}
				{@const ycol = getColumnById(outId)}
				{#if ycol}<ColumnComponent col={ycol} />{/if}
			{/if}
		{/each}
	</div>
</div>

<style>
	.hint {
		font-size: var(--font-sm);
		color: var(--color-text-muted, #666);
		margin: var(--space-1) 0 0;
	}
	.interp-preview {
		border-collapse: collapse;
		font-size: var(--font-sm);
	}
	.interp-preview th,
	.interp-preview td {
		border: 1px solid var(--color-lightness-90, #e6e6e6);
		padding: 1px 6px;
		text-align: right;
		white-space: nowrap;
	}
</style>
