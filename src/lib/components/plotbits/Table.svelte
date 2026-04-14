<script>
	import Editable from '../inputs/Editable.svelte';

	let { headers, data, editable = false, onInput = () => {} } = $props();

	// Initialize widths array with fixed pixel widths so columns don't shrink
	// to fit and the table can overflow its container (enabling horizontal scroll).
	const defaultColWidth = 120; // px
	let widths = $state(headers.map(() => defaultColWidth + 'px'));
	let resizingIndex = -1;
	let table;
	const minWidth = 30; // Minimum column width in pixels

	function startResize(index) {
		resizingIndex = index;
		window.addEventListener('mousemove', handleMouseMove);
		window.addEventListener('mouseup', handleMouseUp);
	}

	function handleMouseMove(event) {
		if (resizingIndex >= 0) {
			const th = table.querySelectorAll('th')[resizingIndex];
			const newWidth = Math.max(minWidth, event.clientX - th.getBoundingClientRect().left);
			widths = widths.map((w, i) => (i === resizingIndex ? `${newWidth}px` : w));
		}
	}

	// Reset widths when column set changes.
	$effect(() => {
		if (headers) {
			widths = headers.map(() => defaultColWidth + 'px');
		}
	});

	function handleMouseUp() {
		resizingIndex = -1;
		window.removeEventListener('mousemove', handleMouseMove);
		window.removeEventListener('mouseup', handleMouseUp);
	}

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
				{#each headers as header, index}
					<th style="width: {widths[index]}">
						<Editable
							{editable}
							value={headers[index]}
							onInput={(v) => onInput({ col: index, row: 'h', value: v, old: oldVal })}
						/>
						<div class="resizer" onmousedown={() => startResize(index)}></div>
					</th>
				{/each}
			</tr>
		</thead>
		<tbody>
			{#each new Array(Math.max(0, ...data.map((col) => col?.length ?? 0))) as d, r}
				<tr>
					{#each data as col, c}
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
										<div class="computed-time">{col[r].computed} hrs</div>
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
		font-size: 14px;
		background-color: white;
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
		border: 1px solid #ccc;
		padding: 0.5rem;
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
		color: var(--color-lightness-50, #888);
		line-height: 1.2;
		padding-left: 4px;
		white-space: nowrap;
	}

	.null-value {
		color: var(--color-lightness-70, #aaa);
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
</style>
