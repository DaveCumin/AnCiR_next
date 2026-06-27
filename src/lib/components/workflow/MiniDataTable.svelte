<script>
	// @ts-nocheck
	import { core } from '$lib/core/core.svelte.js';
	import { formatTimeFromUNIX } from '$lib/utils/time/TimeUtils.js';
	import { formatDateTime } from '$lib/utils/time/displayTime.js';

	let { column, maxRows = 5 } = $props();

	const MAX_CELL = 14;
	const DP = 2; // decimal places (the tableplot uses its own; 2 is a sane preview default)

	// Time / bin columns get the same two-part formatting as the tableplot:
	//   time → readable time + hours-since-start; bin → midpoint ± half-width.
	const isTime = $derived(
		column?.type === 'time' && !column?.isReferencial?.() && column?.compression !== 'awd'
	);
	const isBin = $derived(column?.type === 'bin');

	// Raw stored series (used for the time/bin formatting, mirroring the tableplot).
	const rawArr = $derived(isTime || isBin ? core.rawData.get(column?.data) : null);
	const data = $derived(typeof column?.getData === 'function' ? column.getData() : []);
	// Time source: the raw stored series for source columns, else getData() (UNIX
	// ms) so producer/derived time columns (which carry no rawData) still render as
	// dates rather than raw numbers.
	const timeArr = $derived(
		isTime ? (Array.isArray(rawArr) ? rawArr : Array.isArray(data) ? data : null) : null
	);
	const total = $derived(
		isTime && Array.isArray(timeArr)
			? timeArr.length
			: isBin && Array.isArray(rawArr)
				? rawArr.length
				: (data?.length ?? 0)
	);
	const previewN = $derived(Math.min(maxRows, total));

	function formatNumber(v) {
		if (v == null) return '—';
		if (typeof v === 'number') {
			if (!Number.isFinite(v)) return String(v);
			return Number.isInteger(v) ? String(v) : Number(v.toPrecision(4)).toString();
		}
		const s = String(v);
		return s.length <= MAX_CELL ? s : s.slice(0, MAX_CELL - 1) + '…';
	}

	function cellAt(i) {
		// Bin: midpoint with ± half-width.
		if (isBin && Array.isArray(rawArr)) {
			const x = rawArr[i];
			if (!Number.isFinite(x)) return { raw: '-', computed: '-', isTime: true };
			const binStep = column.binStep ?? column.binWidth ?? 0;
			const rangeStr = `±${((column.binWidth ?? 0) / 2).toFixed(2)}`;
			if (column.originTime_ms != null) {
				const centerMs = column.originTime_ms + (x + binStep / 2) * 3600000;
				return {
					raw: Number.isFinite(centerMs) ? formatDateTime(centerMs) : '-',
					computed: rangeStr,
					isTime: true,
					unit: 'hrs'
				};
			}
			return { raw: (x + binStep / 2).toFixed(DP), computed: rangeStr, isTime: true, unit: 'hrs' };
		}
		// Time: readable time with hours-since-start underneath.
		if (isTime && Array.isArray(timeArr)) {
			const v = timeArr[i];
			const hours = column.hoursSinceStart?.[i];
			const hoursStr = Number.isFinite(hours) ? hours.toFixed(DP) : String(hours ?? '');
			const raw = typeof v === 'number' ? formatTimeFromUNIX(v) : v;
			return { raw, computed: hoursStr, isTime: true, unit: 'hrs' };
		}
		return formatNumber(data?.[i]);
	}
</script>

<div class="mini-table" role="table" aria-label={`Preview of ${column?.name ?? ''}`}>
	<div class="mini-header">{column?.name ?? '(unnamed)'}</div>
	<div class="mini-rows">
		{#each { length: previewN } as _, i (i)}
			{@const cell = cellAt(i)}
			<div class="mini-row">
				{#if cell && cell.isTime}
					<span class="mt-raw">{cell.raw}</span>
					{#if String(cell.computed) !== String(cell.raw)}
						<span class="mt-computed">{cell.computed}{cell.unit ? ' ' + cell.unit : ''}</span>
					{/if}
				{:else}
					{cell}
				{/if}
			</div>
		{/each}
		{#if total === 0}
			<div class="mini-row empty">no data</div>
		{/if}
	</div>
	{#if total > 0}
		<div class="mini-footer">{total} rows total</div>
	{/if}
</div>

<style>
	.mini-table {
		font-family: var(--font-mono, ui-monospace, SF Mono, monospace);
		font-size: 0.7rem;
		background: var(--color-lightness-95, #fafafa);
		border: 1px solid var(--color-lightness-85, #e8e8e8);
		border-radius: 0.2rem;
		padding: var(--space-2) var(--space-3);
		min-width: 70px;
	}
	.mini-header {
		font-weight: 600;
		padding-bottom: var(--space-2);
		margin-bottom: var(--space-2);
		border-bottom: 1px solid var(--color-lightness-85, #e8e8e8);
		color: var(--color-lightness-25, #333);
	}
	.mini-rows {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.mini-row {
		display: flex;
		flex-direction: column;
		padding: var(--space-1) 0;
		color: var(--color-lightness-35, #555);
	}
	.mt-computed {
		font-size: 0.85em;
		color: var(--color-text-muted, #666);
		line-height: 1.1;
	}
	.mini-row.empty {
		font-style: italic;
		opacity: 0.6;
	}
	.mini-footer {
		font-size: 0.65rem;
		color: var(--color-text-muted, #666);
		margin-top: var(--space-2);
		padding-top: var(--space-2);
		border-top: 1px dashed var(--color-lightness-85, #eee);
	}
</style>
