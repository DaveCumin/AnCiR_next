<script>
	let { headers, data, editable = false, onInput = () => {} } = $props();

	// Initialize widths array with equal distribution
	let widths = $state(headers.map(() => 100 / headers.length + '%'));
	let resizingIndex = -1;
	let totalWidth = 0;
	let table;
	const minWidth = 30; // Minimum column width in pixels

	function startResize(index) {
		resizingIndex = index;
		window.addEventListener('mousemove', handleMouseMove);
		window.addEventListener('mouseup', handleMouseUp);
	}

	function handleMouseMove(event) {
		if (resizingIndex >= 0) {
			totalWidth = table.offsetWidth;
			const th = table.querySelectorAll('th')[resizingIndex];
			const newWidth = event.clientX - th.getBoundingClientRect().left;

			// Convert pixel width to percentage
			const newWidthPercent = Math.max(
				(newWidth / totalWidth) * 100,
				(minWidth / totalWidth) * 100
			);

			// Calculate the adjustment needed
			const oldWidth = parseFloat(widths[resizingIndex]);
			const widthDiff = newWidthPercent - oldWidth;

			// Update widths while maintaining total width
			widths = widths.map((w, i) => {
				if (i === resizingIndex) {
					return `${newWidthPercent}%`;
				}
				if (i === resizingIndex + 1) {
					const currentWidth = parseFloat(w);
					const newAdjustedWidth = Math.max(
						currentWidth - widthDiff,
						(minWidth / totalWidth) * 100
					);
					return `${newAdjustedWidth}%`;
				}

				return w;
			});
		}
	}

	//update the widths when data is changed.
	$effect(() => {
		if (headers) {
			widths = headers.map(() => 100 / headers.length + '%');
		}
	});

	function handleMouseUp() {
		resizingIndex = -1;
		window.removeEventListener('mousemove', handleMouseMove);
		window.removeEventListener('mouseup', handleMouseUp);
	}

	let oldVal;
</script>

<div class="preview-table-wrapper" bind:this={table} style="margin-top: 0.2rem;">
	<table style="width: 100%; table-layout: fixed;">
		<thead>
			<tr>
				{#each headers as header, index}
					<th
						style="width: {widths[index]}; position: relative;"
						contenteditable="false"
						ondblclick={(e) => {
							if (editable) {
								oldVal = e.target.innerText;
								e.target.setAttribute('contenteditable', 'true');
								e.target.focus();
								console.log(e.target);
							}
						}}
						oninput={(e) => {
							onInput({ col: index, row: 'h', value: e.target.innerText, old: oldVal });
						}}
					>
						{header}
						<div class="resizer" onmousedown={() => startResize(index)}></div>
					</th>
				{/each}
			</tr>
		</thead>
		<tbody>
			{#each new Array(data[0].length) as d, r}
				<tr>
					{#each data as col, c}
						<td
							contenteditable="false"
							ondblclick={(e) => {
								if (editable) {
									oldVal = e.target.innerText;
									e.target.setAttribute('contenteditable', 'true');
									e.target.focus();
									console.log(e.target);
								}
							}}
							oninput={(e) => {
								console.log(e);
								onInput({ col: c, row: r, value: e.target.innerText, old: oldVal });
								e.target.setAttribute('contenteditable', 'false');
							}}>{col[r] ?? 'N/A'}</td
						>
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
	}

	:global(.preview-table-wrapper table) {
		width: 100%;
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
		text-overflow: ellipsis;
		white-space: nowrap;
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
