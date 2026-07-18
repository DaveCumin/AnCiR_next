<script module>
	import { normalizeYInputs, migrateLegacyYIN } from '$lib/tableProcesses/tpArgHelpers.js';
	import { writeOutputColumn } from '$lib/tableProcesses/outputColumns.js';
	import { core } from '$lib/core/core.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';

	const displayName = 'Split data';
	const defaults = new Map([
		['xIN', { val: -1 }],
		['yIN', { val: [] }],
		['splitTimes', { val: [] }],
		['out', {}],
		['valid', { val: false }],
		['forcollected', { val: false }],
		['collectedType', { val: 'split' }]
	]);

	export function evaluateSplit(argsIN) {
		const xIN = argsIN.xIN;
		const yINs = normalizeYInputs(argsIN.yIN);
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

		// Process each Y column
		for (const yId of yINs) {
			if (yId == null || yId === -1) continue;
			const yCol = getColumnById(yId);
			if (!yCol) continue;

			const y = yCol.getData();

			// Create full-length segments with null for non-matching rows (like Filter)
			const segments = [];
			let prevTime = -Infinity;

			for (let seg = 0; seg < segmentCount; seg++) {
				const nextTime = seg < splitTimes.length ? splitTimes[seg] : Infinity;

				const segmentData = t.map((time, i) => {
					if (time == null || isNaN(time) || y[i] == null || isNaN(y[i])) return null;
					if (typeof time === 'number' && time >= prevTime && time < nextTime) return y[i];
					return null;
				});

				segments.push(segmentData);
				prevTime = nextTime;
			}

			y_results[yId] = {
				segments,
				sourceColName: yCol.name || String(yId)
			};
		}

		if (Object.keys(y_results).length === 0) {
			return [null, false];
		}

		return [
			{
				y_results,
				splitTimes,
				segmentCount
			},
			true
		];
	}

	function writeSplitOutputs(argsIN, splitData) {
		if (!splitData?.y_results) return;
		const hasOut = Object.values(argsIN.out ?? {}).some((v) => Number(v) >= 0);
		if (!hasOut) return;

		const processHash = crypto.randomUUID();
		for (const yId of Object.keys(splitData.y_results)) {
			// Preserve the input column's type on the segment outputs — a time column
			// stays time rather than becoming numeric. The segment data is already the
			// column's getData() output (UNIX ms for a time column), so clear
			// timeFormat to stop getData re-parsing it.
			const srcType = getColumnById(Number(yId))?.type ?? 'number';
			const opts = { processHash, type: srcType };
			if (srcType === 'time') opts.timeFormat = null;
			for (let seg = 0; seg < splitData.segmentCount; seg++) {
				const outId = argsIN.out[`${yId}_${seg + 1}`];
				const segData = splitData.y_results[yId]?.segments?.[seg];
				if (segData) writeOutputColumn(outId, segData, opts);
			}
		}
	}

	export function split(argsIN) {
		const [splitData, valid] = evaluateSplit(argsIN);
		if (valid && splitData) writeSplitOutputs(argsIN, splitData);
		return [splitData, valid];
	}

	export const definition = {
		displayName,
		defaults,
		func: split,
		columnIdFields: { scalar: ['xIN'], array: ['yIN'] },
		nodeSpec: {
			id: 'tableprocess.split',
			inputs: [
				{ name: 'xIN', kind: 'column', cardinality: 'one' },
				{ name: 'yIN', kind: 'column', cardinality: 'many' }
			],
			outputs: [{ name: 'segments', kind: 'column', cardinality: 'many' }]
		}
	};
</script>

<script>
	// @ts-nocheck
	import LoadingSpinner from '$lib/components/LoadingSpinner.svelte';
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';
	import DateTimeHrs from '$lib/components/inputs/DateTimeHrs.svelte';
	import Table from '$lib/components/plotbits/Table.svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import ColumnComponent from '$lib/core/Column.svelte';
	import { Column, getColumnById, removeColumn } from '$lib/core/Column.svelte';
	import { pushObj } from '$lib/core/core.svelte.js';
	import { formatTimeFromUNIX } from '$lib/utils/time/TimeUtils.js';
	import { onMount, untrack } from 'svelte';

	let { p = $bindable(), hideInputs = false } = $props();

	// Backwards compatibility
	migrateLegacyYIN(p.args);
	if (!Array.isArray(p.args.splitTimes)) {
		p.args.splitTimes = [];
	}
	if (typeof p.args.out !== 'object' || p.args.out === null) {
		p.args.out = {};
	}

	// Migrate old key formats: remove "split_*" keys and 0-indexed "*_0" keys
	for (const key of Object.keys(p.args.out)) {
		if (key.startsWith('split_') || key.endsWith('_0')) {
			const outColId = p.args.out[key];
			if (outColId != null && outColId >= 0) {
				core.rawData.delete(outColId);
				removeColumn(outColId);
				if (p.parent) {
					p.parent.columnRefs = p.parent.columnRefs.filter((id) => id !== outColId);
				}
			}
			delete p.args.out[key];
		}
	}

	// Clean up orphaned columns: any column in columnRefs that isn't tracked by a current p.args.out value
	if (p.parent) {
		const activeOutIds = new Set(Object.values(p.args.out).filter((v) => v != null && v >= 0));
		// Also collect IDs from other tableprocesses on this table so we don't remove their columns
		const inputIds = new Set([p.args.xIN, ...(p.args.yIN ?? [])].filter((v) => v >= 0));
		const orphans = p.parent.columnRefs.filter((id) => {
			if (activeOutIds.has(id)) return false; // currently tracked output
			if (inputIds.has(id)) return false; // input column
			const col = getColumnById(id);
			if (!col) return true; // column doesn't exist, clean up ref
			// Only remove columns that look like split outputs (name contains "_split" or matches old patterns)
			return col.name?.includes('_split') || col.name?.match(/^.+_\d+$/);
		});
		for (const orphanId of orphans) {
			core.rawData.delete(orphanId);
			removeColumn(orphanId);
		}
		if (orphans.length > 0) {
			p.parent.columnRefs = p.parent.columnRefs.filter((id) => !orphans.includes(id));
		}
	}

	let splitResult = $state(null);
	let mounted = $state(false);
	let calculating = $state(false);
	let previewStart = $state(1);
	let _calcToken = 0;

	// Track previous Y IDs
	let prevYIds = [...(p.args.yIN ?? [])].map(Number);

	// Reactivity: recompute when inputs or split times change
	let xIN_col = $derived.by(() => (p.args.xIN >= 0 ? getColumnById(p.args.xIN) : null));
	let xIsTime = $derived(xIN_col?.type === 'time');
	let sortedSplitTimes = $derived([...(p.args.splitTimes ?? [])].sort((a, b) => a - b));
	let timesWereReordered = $derived(
		(p.args.splitTimes ?? []).some((t, i) => t !== sortedSplitTimes[i])
	);
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

	// Create one free-standing output column and return its id. Works for both
	// free-standing TP nodes (no parent — the common case now) and legacy
	// parent-table TPs. buildTPOutputs only needs a valid args.out id; we also
	// tag the column so it's treated as a computed output rather than raw data.
	function createOutputColumn(srcName, seg) {
		const col = new Column({});
		col.name = `${srcName}_split${seg}`;
		col.tableProcessGUId = p.parent ? p.parent.id : `split_${p.id}`;
		pushObj(col);
		if (p.parent) p.parent.columnRefs = [col.id, ...p.parent.columnRefs];
		return col.id;
	}

	// Reconcile output columns to exactly one per (selected Y, segment): create
	// missing ones, drop stale ones (deselected Y or segments beyond the current
	// count). Returns true if anything changed. Does NOT require a parent table,
	// which is why the old p.parent-gated creation produced no outputs on the
	// free-standing node.
	function reconcileOutputs() {
		const yIds = (p.args.yIN ?? []).map(Number).filter((id) => id >= 0);
		const desired = [];
		const desiredKeys = new Set();
		for (const yId of yIds) {
			for (let seg = 1; seg <= segmentCount; seg++) {
				const key = `${yId}_${seg}`;
				desired.push({ key, yId, seg });
				desiredKeys.add(key);
			}
		}

		let changed = false;

		// Keys present but no longer wanted: candidates to REUSE (preferred) or drop.
		// Reusing a stale column for a new key of the SAME segment keeps that
		// column's id stable when a Y input is swapped (e.g. when a node is spliced
		// upstream, changing yIN in place). That is what keeps a downstream consumer
		// wired to this output — like a plot — connected instead of orphaned.
		const staleKeys = Object.keys(p.args.out).filter(
			(k) => !desiredKeys.has(k) && Number(p.args.out[k]) >= 0
		);
		const staleBySeg = new Map();
		for (const k of staleKeys) {
			const seg = Number(k.split('_')[1]);
			if (!staleBySeg.has(seg)) staleBySeg.set(seg, []);
			staleBySeg.get(seg).push(k);
		}

		// Transfer a stale column to each missing desired key of the same segment.
		const reusedStale = new Set();
		for (const d of desired) {
			if (Number(p.args.out[d.key]) >= 0) continue; // already present
			const pool = staleBySeg.get(d.seg);
			if (pool && pool.length) {
				const oldKey = pool.shift();
				const colId = p.args.out[oldKey];
				delete p.args.out[oldKey];
				reusedStale.add(oldKey);
				p.args.out[d.key] = colId;
				const col = getColumnById(colId);
				if (col) col.name = `${getColumnById(d.yId)?.name ?? d.yId}_split${d.seg}`;
				changed = true;
			}
		}

		// Drop any stale columns that weren't reused.
		for (const k of staleKeys) {
			if (reusedStale.has(k)) continue;
			const colId = p.args.out[k];
			if (colId != null && colId >= 0) {
				core.rawData.delete(colId);
				removeColumn(colId);
				if (p.parent) p.parent.columnRefs = p.parent.columnRefs.filter((id) => id !== colId);
			}
			delete p.args.out[k];
			changed = true;
		}

		// Create any outputs still missing.
		for (const d of desired) {
			if (Number(p.args.out[d.key]) >= 0) continue;
			const srcName = getColumnById(d.yId)?.name ?? String(d.yId);
			p.args.out[d.key] = createOutputColumn(srcName, d.seg);
			changed = true;
		}

		prevYIds = [...yIds];
		return changed;
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
		// Exclude only this Split's own output columns (a node can't split its own
		// output). The X column IS allowed as a Y — you can split it against itself.
		const ids = [];
		for (const key of Object.keys(p.args.out)) {
			if (p.args.out[key] >= 0) {
				ids.push(p.args.out[key]);
			}
		}
		return ids.filter((id) => id >= 0);
	});

	// Reconcile output columns whenever the Y selection OR the number of segments
	// (driven by splitTimes) changes, then recompute.
	$effect(() => {
		const _yIN = p.args.yIN;
		const _segs = segmentCount;
		if (!mounted) return;
		// Reconcile OUTSIDE this effect. reconcileOutputs() calls `new Column()`, and a
		// $derived created while an effect is the active reaction becomes inert when
		// that effect re-runs (Svelte's `derived_inert`) — so a *reused* segment column
		// would be left owned by a now-destroyed effect and read stale/empty data (e.g.
		// the pre-split-time segment failing to plot). Running in a microtask (no active
		// effect) makes the new columns' deriveds root-owned, so they stay live.
		queueMicrotask(() => {
			if (reconcileOutputs()) recalculate();
		});
	});

	onMount(() => {
		// Initialize / materialise output columns on mount (creates them for the
		// free-standing node, which has no parent table).
		const needsCompute = reconcileOutputs();

		// Did we end up with real segment data? Stays false unless the load branch below finds
		// populated output columns. Gates whether we pin `lastHash` — the difference between a
		// session that computes on load and one that stays blank forever.
		let loaded = false;

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
						const outKey = `${yId}_${seg + 1}`;
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
					previewStart = 1;
					splitResult = {
						y_results,
						splitTimes: p.args.splitTimes,
						segmentCount
					};
					p.args.valid = true;
					loaded = true;
				}
			}
		}

		const inputsAreStale =
			!needsCompute &&
			((p.args.xIN >= 0 && (getColumnById(p.args.xIN)?.rawDataVersion ?? 0) > 0) ||
				(p.args.yIN ?? []).some((id) => (getColumnById(id)?.rawDataVersion ?? 0) > 0));
		// Pin the hash ONLY when we actually loaded current data — that legitimately suppresses a
		// redundant recompute. When the output columns exist but are EMPTY (a freshly-normalized
		// AI session pre-allocates them without values), we must NOT pin it: leaving lastHash
		// unset lets the post-mount $effect fire and compute, exactly as BinnedData does. Pinning
		// here regardless was why a Split loaded from such a session — and every analysis
		// downstream of it — stayed permanently blank.
		if (loaded && !inputsAreStale) lastHash = getHash;
		mounted = true;
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
				<p>X column (time or number)</p>
				<ColumnSelector
					bind:value={p.args.xIN}
					optionDisabled={(id) => {
						const t = getColumnById(id)?.type;
						return t === 'time' || t === 'number'
							? null
							: 'X must be a time or number column to split on.';
					}}
				/>
			</div>
			<div class="control-input">
				<p>Y columns to split</p>
				<ColumnSelector bind:value={p.args.yIN} excludeColIds={yExcludeIds} multiple={true} />
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

					<button class="icon" onclick={() => removeSplitTime(idx)}>
						<Icon name="trash" width={16} height={16} className="menu-icon" />
					</button>
				</div>
			{/each}
		</div>

		<button class="btn-add" onclick={addSplitTime}>+ Add split time</button>

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

<!-- Output -->
<details open>
	<summary class="section-details-summary">Output</summary>
	<div class="section-row">
		<div class="section-content">
			{#if calculating}
				<LoadingSpinner message="Splitting data…" />
			{:else if p.args.valid && splitResult && Object.values(p.args.out).some((id) => id >= 0)}
				<div class="tableProcess-label"><span>Output</span></div>
				{#each p.args.yIN ?? [] as yId}
					{@const yResult = splitResult.y_results[yId]}
					{#if yResult}
						{#each yResult.segments as _, segIdx}
							{@const outKey = `${yId}_${segIdx + 1}`}
							{@const outId = p.args.out[outKey]}
							{#if outId >= 0}
								{@const outCol = getColumnById(outId)}
								{#if outCol}
									<ColumnComponent col={outCol} />
								{/if}
							{/if}
						{/each}
					{/if}
				{/each}
			{:else if p.args.valid && splitResult}
				<!-- Preview table (before commit) -->
				{@const tCol = getColumnById(p.args.xIN)}
				{@const tData = tCol?.getData() ?? []}
				{@const totalRows = tData.length}
				{@const previewHeaders = [
					tCol?.name ?? 'x',
					...(p.args.yIN ?? []).flatMap((yId) => {
						const yResult = splitResult.y_results[yId];
						if (!yResult) return [];
						return yResult.segments.map((_, segIdx) => {
							return `${yResult.sourceColName}_split${segIdx + 1}`;
						});
					})
				]}
				{@const previewData = [
					xIsTime
						? tData.slice(previewStart - 1, previewStart + 5).map((t) => ({
								isTime: true,
								raw: formatTimeFromUNIX(t),
								computed: ((t - tData[0]) / 3600000).toFixed(2)
							}))
						: tData.slice(previewStart - 1, previewStart + 5),
					...(p.args.yIN ?? []).flatMap((yId) => {
						const yResult = splitResult.y_results[yId];
						if (!yResult) return [];
						return yResult.segments.map((seg) => seg.slice(previewStart - 1, previewStart + 5));
					})
				]}
				{#if totalRows > 0}
					<Table headers={previewHeaders} data={previewData} />
					<p>
						Row <NumberWithUnits
							min={1}
							max={Math.max(1, totalRows - 5)}
							step={1}
							bind:value={previewStart}
						/> to {Math.min(previewStart + 5, totalRows)} of {totalRows}
					</p>
				{/if}
			{:else if p.args.valid === false && p.args.xIN >= 0}
				<p>Need valid time and value columns to split data. Ensure X and Y are selected.</p>
			{:else}
				<p>Select X (time) and Y (value) columns to begin splitting.</p>
			{/if}
		</div>
	</div>
</details>

<style>
	.split-times-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		margin-bottom: 0.8rem;
	}

	.split-time-row {
		display: flex;
		gap: var(--space-4);
		align-items: center;
	}

	.reorder-warning {
		background: var(--color-lightness-95);
		border-left: 3px solid var(--color-warning);
		padding: 0.6rem;
		margin-bottom: 0.8rem;
		border-radius: var(--radius-xs);
	}

	.reorder-warning p {
		margin: 0.2rem 0;
		font-size: var(--font-sm);
		color: var(--color-lightness-35);
	}

	.split-info {
		font-size: var(--font-sm);
		color: var(--color-lightness-40);
		margin-top: var(--space-4);
	}
</style>
