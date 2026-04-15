<script module>
	import { core } from '$lib/core/core.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';

	export const split_displayName = 'Split data';

	export const split_defaults = new Map([
		['xIN', { val: -1 }],
		['yIN', { val: [] }],
		['splitTimes', { val: [] }],
		['out', { val: {} }],
		['valid', { val: false }],
		['forcollected', { val: false }],
		['collectedType', { val: 'split' }]
	]);

	export function split(argsIN) {
		const xIN = argsIN.xIN;
		const yINraw = argsIN.yIN;
		const yINs = Array.isArray(yINraw) ? yINraw : yINraw != null && yINraw !== -1 ? [yINraw] : [];
		let splitTimes = Array.isArray(argsIN.splitTimes) ? [...argsIN.splitTimes] : [];

		// Validate inputs
		if (xIN == -1 || !getColumnById(xIN) || yINs.length === 0) {
			return [null, false];
		}

		// Get time column data (use raw data for comparison, matching Filter behaviour)
		const tCol = getColumnById(xIN);
		const t = tCol.getData();

		// Sort split times internally
		splitTimes = splitTimes.sort((a, b) => a - b);

		if (splitTimes.length === 0) {
			return [null, false];
		}

		const segmentCount = splitTimes.length + 1;
		const y_results = {};
		let totalRows = 0;

		// Process each Y column
		for (const yId of yINs) {
			if (yId == null || yId === -1) continue;
			const yCol = getColumnById(yId);
			if (!yCol) continue;

			const y = yCol.getData();

			// Find valid indices (non-NaN time and y values)
			const validIndices = t
				.map((v, i) => (v == null || isNaN(v) || y[i] == null || isNaN(y[i]) ? -1 : i))
				.filter((i) => i !== -1);

			if (validIndices.length < 1) continue;

			// Extract valid data
			const tt = validIndices.map((i) => t[i]);
			const yy = validIndices.map((i) => y[i]);

			// Create segments
			const segments = [];
			let prevTime = -Infinity;

			for (let seg = 0; seg < segmentCount; seg++) {
				const nextTime = seg < splitTimes.length ? splitTimes[seg] : Infinity;

				// Collect data for this segment: prevTime ≤ t < nextTime
				const segmentIndices = tt
					.map((time, idx) => {
						const inRange = typeof time === 'number' && time >= prevTime && time < nextTime;
						return inRange ? idx : -1;
					})
					.filter((i) => i !== -1);

				const segmentData = segmentIndices.map((i) => yy[i]).filter((v) => v != null);
				segments.push(segmentData);
				totalRows += segmentData.length;

				prevTime = nextTime;
			}

			y_results[yId] = {
				segments,
				sourceColName: yCol.name || String(yId),
				validIndices
			};
		}

		if (Object.keys(y_results).length === 0) {
			return [null, false];
		}

		return [
			{
				y_results,
				splitTimes,
				segmentCount,
				totalRows,
				t
			},
			true
		];
	}
</script>

<script>
	// @ts-nocheck
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';
	import ColumnComponent from '$lib/core/Column.svelte';
	import LoadingSpinner from '$lib/components/LoadingSpinner.svelte';
	import DateTimeHrs from '$lib/components/inputs/DateTimeHrs.svelte';
	import { Column, getColumnById, removeColumn } from '$lib/core/Column.svelte';
	import { pushObj } from '$lib/core/core.svelte.js';
	import { formatTimeFromUNIX } from '$lib/utils/time/TimeUtils.js';
	import { onMount, untrack } from 'svelte';

	let { p = $bindable(), hideInputs = false } = $props();

	// Backwards compatibility
	if (typeof p.args.yIN === 'number') {
		p.args.yIN = p.args.yIN !== -1 ? [p.args.yIN] : [];
	}
	if (!Array.isArray(p.args.splitTimes)) {
		p.args.splitTimes = [];
	}
	if (typeof p.args.out !== 'object' || p.args.out === null) {
		p.args.out = {};
	}

	let splitResult = $state(null);
	let mounted = $state(false);
	let calculating = $state(false);
	let _calcToken = 0;

	// Track previous Y IDs
	let prevYIds = [...(p.args.yIN ?? [])].map(Number);

	// Reactivity: recompute when inputs or split times change
	let xIN_col = $derived.by(() => (p.args.xIN >= 0 ? getColumnById(p.args.xIN) : null));
	let xIsTime = $derived(xIN_col?.type === 'time');
	let sortedSplitTimes = $derived([...p.args.splitTimes].sort((a, b) => a - b));
	let timesWereReordered = $derived(p.args.splitTimes.some((t, i) => t !== sortedSplitTimes[i]));
	let segmentCount = $derived(sortedSplitTimes.length + 1);

	function formatSplitLabel(val) {
		if (val == null) return '?';
		if (xIsTime) return formatTimeFromUNIX(val);
		return val.toFixed(2);
	}

	let getHash = $derived.by(() => {
		let out = '';
		out += xIN_col?.getDataHash ?? '';
		for (const yId of p.args.yIN ?? []) {
			const col = getColumnById(yId);
			out += col?.getDataHash ?? '';
		}
		out += p.args.splitTimes.join(',');
		return out;
	});
	let lastHash = '';

	$effect(() => {
		const dataHash = getHash;
		if (!mounted) return;
		if (lastHash !== dataHash) {
			lastHash = getHash;
			calculating = true;
			const token = ++_calcToken;
			setTimeout(() => {
				if (token !== _calcToken) return;
				untrack(() => {
					[splitResult, p.args.valid] = split(p.args);
					recalculate();
				});
				calculating = false;
			}, 0);
		}
	});

	// Called when Y selection changes
	function onYSelectionChange() {
		const newIds = (p.args.yIN ?? []).map(Number).filter((id) => id >= 0);
		const newSet = new Set(newIds);
		const oldSet = new Set(prevYIds);

		// Skip if no actual change
		if (newIds.length === prevYIds.length && newIds.every((id) => oldSet.has(id))) return;

		// Remove output columns for deselected Y inputs
		for (const oldId of prevYIds) {
			if (!newSet.has(oldId)) {
				for (let seg = 0; seg < segmentCount; seg++) {
					const outKey = `split_${oldId}_seg${seg}`;
					const outColId = p.args.out[outKey];
					if (outColId != null && outColId >= 0) {
						core.rawData.delete(outColId);
						removeColumn(outColId);
					}
					delete p.args.out[outKey];
				}
			}
		}

		// Create output columns for newly selected Y inputs
		for (const newId of newIds) {
			const srcName = getColumnById(newId)?.name ?? String(newId);
			for (let seg = 0; seg < segmentCount; seg++) {
				const outKey = `split_${newId}_seg${seg}`;
				if (p.args.out[outKey] == null || p.args.out[outKey] === -1) {
					if (p.parent) {
						const yCol = new Column({});
						yCol.name = `split_${srcName}_seg${seg}`;
						pushObj(yCol);
						p.parent.columnRefs = [yCol.id, ...p.parent.columnRefs];
						p.args.out[outKey] = yCol.id;
					}
				}
			}
		}

		// Update tracking
		prevYIds = [...newIds];

		// Recompute
		recalculate();
	}

	function recalculate() {
		calculating = true;
		const token = ++_calcToken;
		setTimeout(() => {
			if (token !== _calcToken) return;
			[splitResult, p.args.valid] = split(p.args);
			calculating = false;
			lastHash = getHash;
		}, 0);
	}

	function addSplitTime() {
		p.args.splitTimes = [...p.args.splitTimes, 0];
	}

	function removeSplitTime(index) {
		p.args.splitTimes = p.args.splitTimes.filter((_, i) => i !== index);
	}

	// Exclude own output column IDs from the Y selector
	let yExcludeIds = $derived.by(() => {
		const ids = [p.args.xIN];
		for (const key of Object.keys(p.args.out)) {
			if (p.args.out[key] >= 0) {
				ids.push(p.args.out[key]);
			}
		}
		return ids.filter((id) => id >= 0);
	});

	$effect(() => {
		const _yIN = p.args.yIN;
		if (!mounted) return;
		untrack(() => onYSelectionChange());
	});

	onMount(() => {
		// Initialize output columns on mount
		let needsCompute = false;

		for (const yId of p.args.yIN ?? []) {
			const srcName = getColumnById(yId)?.name ?? String(yId);
			for (let seg = 0; seg < segmentCount; seg++) {
				const outKey = `split_${yId}_seg${seg}`;
				if (p.args.out[outKey] == null || p.args.out[outKey] === -1) {
					if (p.parent) {
						const yCol = new Column({});
						yCol.name = `split_${srcName}_seg${seg}`;
						pushObj(yCol);
						p.parent.columnRefs = [yCol.id, ...p.parent.columnRefs];
						p.args.out[outKey] = yCol.id;
						needsCompute = true;
					}
				}
			}
		}

		prevYIds = [...(p.args.yIN ?? [])].map(Number);

		if (needsCompute) {
			recalculate();
		} else {
			// Try to load existing data
			const hasData = Object.entries(p.args.out).some(([, colId]) => {
				return colId >= 0 && core.rawData.has(colId) && core.rawData.get(colId).length > 0;
			});

			if (hasData) {
				const y_results = {};
				for (const yId of p.args.yIN ?? []) {
					const srcName = getColumnById(yId)?.name ?? String(yId);
					const segments = [];
					for (let seg = 0; seg < segmentCount; seg++) {
						const outKey = `split_${yId}_seg${seg}`;
						const outColId = p.args.out[outKey];
						if (outColId >= 0 && core.rawData.has(outColId)) {
							segments.push(core.rawData.get(outColId));
						}
					}
					if (segments.length > 0) {
						y_results[yId] = { segments, sourceColName: srcName };
					}
				}
				if (Object.keys(y_results).length > 0) {
					splitResult = {
						y_results,
						splitTimes: p.args.splitTimes,
						segmentCount,
						totalRows: Object.values(y_results).reduce(
							(sum, yr) => sum + yr.segments.reduce((s, seg) => s + seg.length, 0),
							0
						)
					};
					p.args.valid = true;
				}
			}
		}

		lastHash = getHash;
		mounted = true;
	});

	// Write data to output columns when valid
	$effect(() => {
		if (!splitResult || !p.args.valid) return;

		for (const [yId, yResult] of Object.entries(splitResult.y_results)) {
			for (let seg = 0; seg < segmentCount; seg++) {
				const outKey = `split_${yId}_seg${seg}`;
				const outId = p.args.out[outKey];
				if (outId >= 0 && yResult.segments[seg]) {
					core.rawData.set(outId, yResult.segments[seg]);
					const outCol = getColumnById(outId);
					if (outCol) {
						outCol.data = outId;
						outCol.type = 'number';
					}
				}
			}
		}
	});
</script>

{#if !hideInputs}
	<!-- Input -->
	<div class="section-row">
		<div class="tableProcess-label">
			<span>Input</span>
		</div>
		<div class="control-input-vertical">
			<div class="control-input">
				<p>X column (time)</p>
				<ColumnSelector bind:value={p.args.xIN} />
			</div>
			<div class="control-input">
				<p>Y columns to split</p>
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

<!-- Split Times -->
<div class="section-row">
	<div class="tableProcess-label">
		<span>Split Times</span>
	</div>
	<div class="control-input-vertical">
		<div class="split-times-list">
			{#each sortedSplitTimes as time, idx (idx)}
				<div class="split-time-row">
					{#if xIsTime}
						<DateTimeHrs bind:value={p.args.splitTimes[idx]} />
					{:else}
						<NumberWithUnits bind:value={p.args.splitTimes[idx]} step="0.1" />
					{/if}
					<button
						class="remove-btn"
						onclick={() => {
							removeSplitTime(idx);
						}}
					>
						Remove ×
					</button>
				</div>
			{/each}
		</div>

		<button class="add-split-time-btn" onclick={addSplitTime}>+ Add split time</button>

		{#if timesWereReordered}
			<div class="reorder-warning">
				<p>Split times auto-sorted:</p>
				<p>Provided: [{p.args.splitTimes.map(formatSplitLabel).join(', ')}]</p>
				<p>Using: [{sortedSplitTimes.map(formatSplitLabel).join(', ')}]</p>
			</div>
		{/if}

		<div class="split-info">
			<p>Segments: <strong>{segmentCount}</strong></p>
		</div>
	</div>
</div>

<!-- Output/Preview -->
<div class="section-row">
	<div class="tableProcess-label">
		<span>Output</span>
	</div>
	<div class="section-content">
		{#if calculating}
			<LoadingSpinner message="Splitting data…" />
		{:else if p.args.valid && splitResult}
			<div class="split-outputs">
				{#each p.args.yIN ?? [] as yId}
					{@const yResult = splitResult.y_results[yId]}
					{#if yResult}
						<div class="split-output-group">
							<h4>{yResult.sourceColName} ({segmentCount} segments)</h4>
							<div class="segments-preview">
								{#each yResult.segments as segmentData, segIdx}
									{@const outKey = `split_${yId}_seg${segIdx}`}
									{@const outId = p.args.out[outKey]}
									<div class="segment-preview">
										<p class="segment-header">
											Segment {segIdx}:
											{#if segIdx === 0}
												time &lt; {formatSplitLabel(sortedSplitTimes[0])}
											{:else if segIdx < segmentCount - 1}
												{formatSplitLabel(sortedSplitTimes[segIdx - 1])} ≤ time &lt;
												{formatSplitLabel(sortedSplitTimes[segIdx])}
											{:else}
												time ≥ {formatSplitLabel(sortedSplitTimes[segmentCount - 2])}
											{/if}
											 — {segmentData.length} rows
										</p>

										<div class="segment-output">
											{#if outId >= 0}
												{@const outCol = getColumnById(outId)}
												{#if outCol}
													<ColumnComponent col={outCol} />
												{/if}
											{/if}
										</div>
									</div>
								{/each}
							</div>
						</div>
					{/if}
				{/each}
			</div>

			<div class="split-stats">
				<p>Total segments: <strong>{segmentCount}</strong></p>
				<p>Total rows: <strong>{splitResult.totalRows}</strong></p>
			</div>
		{:else if p.args.valid === false && p.args.xIN >= 0}
			<p>Need valid time and value columns to split data. Ensure X and Y are selected.</p>
		{:else}
			<p>Select X (time) and Y (value) columns to begin splitting.</p>
		{/if}
	</div>
</div>

<style>
	.split-times-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-bottom: 0.8rem;
	}

	.split-time-row {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}

	.remove-btn {
		padding: 0.4rem 0.8rem;
		font-size: 12px;
		border: 1px solid var(--color-lightness-75, #aaa);
		border-radius: 3px;
		background: none;
		cursor: pointer;
		color: var(--color-lightness-35, #555);
		white-space: nowrap;
	}

	.remove-btn:hover {
		background: var(--color-lightness-95);
		border-color: var(--color-lightness-55, #888);
	}

	.add-split-time-btn {
		padding: 0.6rem 1rem;
		font-size: 13px;
		border: 1px dashed var(--color-lightness-55, #888);
		border-radius: 3px;
		background: var(--color-lightness-97);
		cursor: pointer;
		color: var(--color-lightness-30, #333);
		margin-bottom: 0.8rem;
	}

	.add-split-time-btn:hover {
		background: var(--color-lightness-90);
		border-color: var(--color-lightness-30, #333);
	}

	.reorder-warning {
		background: var(--color-lightness-95);
		border-left: 3px solid #f59e0b;
		padding: 0.6rem;
		margin-bottom: 0.8rem;
		border-radius: 3px;
	}

	.reorder-warning p {
		margin: 0.2rem 0;
		font-size: 12px;
		color: var(--color-lightness-35, #555);
	}

	.split-info {
		font-size: 12px;
		color: var(--color-lightness-40, #666);
		margin-top: 0.5rem;
	}

	.split-outputs {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		margin-bottom: 1rem;
	}

	.split-output-group h4 {
		margin: 0 0 0.8rem 0;
		font-size: 14px;
		color: var(--color-lightness-20, #222);
		border-bottom: 1px solid var(--color-lightness-85, #ccc);
		padding-bottom: 0.4rem;
	}

	.segments-preview {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.segment-preview {
		background: var(--color-lightness-98);
		border: 1px solid var(--color-lightness-90, #ddd);
		border-radius: 4px;
		padding: 0.8rem;
	}

	.segment-header {
		margin: 0 0 0.6rem 0;
		font-size: 12px;
		font-weight: 600;
		color: var(--color-lightness-30, #333);
	}

	.segment-output {
		margin-top: 0.6rem;
	}

	.split-stats {
		font-size: 12px;
		color: var(--color-lightness-40, #666);
		padding-top: 0.8rem;
		border-top: 1px solid var(--color-lightness-90, #ddd);
	}

	.split-stats p {
		margin: 0.4rem 0;
	}
</style>
