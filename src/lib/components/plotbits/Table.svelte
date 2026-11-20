<script>
	import Editable from '../inputs/Editable.svelte';
	import { separatorKeyValue } from '$lib/utils/separatorKeys.js';

	let { headers, data, editable = false, onInput = () => {} } = $props();

	// Fixed pixel column widths, so columns don't shrink to fit and the table can overflow its
	// container (enabling horizontal scroll). A drag overrides them; a new column set resets them.
	const defaultColWidth = 120; // px
	let widths = $derived(headers.map(() => defaultColWidth + 'px'));
	let resizingIndex = -1;
	let table;
	const minWidth = 30; // Minimum column width in pixels
	const maxWidth = 1200; // and the widest (a splitter states its range; End goes there)
	const widthOf = (i) => parseFloat(widths[i]) || defaultColWidth;

	function startResize(index) {
		resizingIndex = index;
		window.addEventListener('mousemove', handleMouseMove);
		window.addEventListener('mouseup', handleMouseUp);
	}

	function handleMouseMove(event) {
		if (resizingIndex >= 0) {
			const th = table.querySelectorAll('th')[resizingIndex];
			const newWidth = Math.min(
				maxWidth,
				Math.max(minWidth, event.clientX - th.getBoundingClientRect().left)
			);
			widths = widths.map((w, i) => (i === resizingIndex ? `${newWidth}px` : w));
		}
	}

	function handleMouseUp() {
		resizingIndex = -1;
		window.removeEventListener('mousemove', handleMouseMove);
		window.removeEventListener('mouseup', handleMouseUp);
	}

	// The same edge from the keyboard (separatorKeys.js): arrows step, Home/End go to the ends.
	// The widths are a viewing convenience, not session state, so nothing is recorded.
	function onResizeKeydown(e, index) {
		const next = separatorKeyValue(e, { value: widthOf(index), min: minWidth, max: maxWidth });
		if (next == null) return;
		e.preventDefault();
		e.stopPropagation();
		widths = widths.map((w, i) => (i === index ? `${next}px` : w));
	}

	// Drop any dangling drag listeners if this unmounts mid-gesture.
	$effect(() => handleMouseUp);

	let oldVal;
</script>

<div
	class="preview-table-wrapper"
	bind:this={table}
	style="margin-top: 0.2rem; margin-bottom: 0rem;"
>
	<table style="width: auto; table-layout: fixed;">
		<thead>
			<tr>
				{#each headers as header, index (index)}
					<th style="width: {widths[index]}">
						<Editable
							{editable}
							value={header}
							onInput={(v) => onInput({ col: index, row: 'h', value: v, old: oldVal })}
						/>
						<!-- Drag strip, or focus it and use the arrow keys (a WAI-ARIA window splitter;
						     Svelte counts every separator as static, hence the ignore, see
						     svelteWarnings.guard.test.js). -->
						<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
						<div
							class="resizer"
							role="separator"
							tabindex="0"
							aria-orientation="vertical"
							aria-label={`Resize column ${header}`}
							aria-valuenow={Math.round(widthOf(index))}
							aria-valuemin={minWidth}
							aria-valuemax={maxWidth}
							onmousedown={() => startResize(index)}
							onkeydown={(e) => onResizeKeydown(e, index)}
						></div>
					</th>
				{/each}
			</tr>
		</thead>
		<tbody>
			<!-- eslint-disable-next-line no-unused-vars -- Array(n) holes; only the row index `r` is used, but the `as` binding is required before it -->
			{#each new Array(Math.max(0, ...data.map((col) => col?.length ?? 0))) as d, r (r)}
				<tr>
					{#each data as col, c (c)}
						<td style="width: {widths[c]}">
							{#if col[r]?.isTime}
								<div class="time-cell">
									<Editable
										value={col[r].raw}
										onInput={(v) => {
											onInput({ col: c, row: r, value: v, old: oldVal });
										}}
									/>
									{#if String(col[r].computed) !== String(col[r].raw)}
										<div class="computed-time">{col[r].computed} h</div>
									{/if}
								</div>
							{:else if col[r] == null}
								<span class="null-value">-</span>
							{:else}
								<Editable
									value={col[r]}
									onInput={(v) => {
										onInput({ col: c, row: r, value: v, old: oldVal });
									}}
								/>
							{/if}
						</td>
					{/each}
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<style>
	/* preview table */
	:global(.preview-table-wrapper) {
		overflow-x: auto;
		overflow-y: hidden;
		height: 100%;
	}

	:global(.preview-table-wrapper table) {
		width: auto;
		table-layout: fixed;
		border-collapse: collapse;
		font-size: var(--font-lg);
		background-color: var(--surface-card);
	}

	:global(.preview-table-wrapper th) {
		padding: 8px 12px;
		border: 1px solid var(--color-lightness-85);
		background-color: var(--color-lightness-97);
		text-align: left;
	}

	:global(.preview-table-wrapper td) {
		padding: 8px 12px;
		border: 1px solid var(--color-lightness-85);
		text-align: left;
		overflow: clip;
	}

	table {
		border-collapse: collapse;
	}

	th,
	td {
		border: 1px solid var(--color-lightness-80);
		padding: var(--space-4);
		text-align: left;
		overflow: hidden;
	}
	.preview-table-wrapper th {
		padding: 8px 12px;
		border: 1px solid var(--color-lightness-85);
		background-color: var(--color-lightness-97);
		text-align: left;
		position: relative; /* Add this */
	}

	.time-cell {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 1px;
	}

	.computed-time {
		font-size: 0.75em;
		color: var(--color-text-muted);
		line-height: 1.2;
		padding-left: 4px;
		white-space: nowrap;
	}

	.null-value {
		/* "missing" vs "zero" is load-bearing in a data table, so this is real text
		   at 4.5:1, not a decorative marker. The old grey was 2.17:1. */
		color: var(--color-text-muted);
	}

	.resizer {
		width: 6px;
		cursor: ew-resize;
		height: 100%;
		position: absolute;
		right: 0;
		top: 0;
		background-color: transparent;
	}

	.resizer:hover {
		background-color: #e0e0e0;
	}
	/* Keyboard focus only; inside the strip, since the cell clips past its edge. */
	.resizer:focus-visible {
		outline: var(--focus-ring);
		outline-offset: -2px;
	}
</style>
