<script>
	let { headers, data } = $props();

	// Initialize widths array with equal distribution
	let widths = $state(headers.map(() => 100 / headers.length + '%'));
	let resizingIndex = -1;
	let totalWidth = 0;
	const minWidth = 50; // Minimum column width in pixels

	function startResize(index) {
		resizingIndex = index;
		window.addEventListener('mousemove', handleMouseMove);
		window.addEventListener('mouseup', handleMouseUp);
	}

	function handleMouseMove(event) {
		if (resizingIndex >= 0) {
			const table = document.querySelector('.preview-table-wrapper table');
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
				// Distribute the difference among other columns
				//TODO: This is a bit weird, but it works
				if (widthDiff !== 0 && i !== resizingIndex) {
					const currentWidth = parseFloat(w);
					const adjustment = (widthDiff / (headers.length - 1)) * (oldWidth / 100);
					const newAdjustedWidth = Math.max(
						currentWidth - adjustment,
						(minWidth / totalWidth) * 100
					);
					return `${newAdjustedWidth}%`;
				}
				return w;
			});
		}
	}

	function handleMouseUp() {
		resizingIndex = -1;
		window.removeEventListener('mousemove', handleMouseMove);
		window.removeEventListener('mouseup', handleMouseUp);
	}
</script>

<div class="preview-table-wrapper">
	<table style="width: 100%; table-layout: fixed;">
		<thead>
			<tr>
				{#each headers as header, index}
					<th style="width: {widths[index]}; position: relative;">
						{header}
						<div class="resizer" on:mousedown={() => startResize(index)}></div>
					</th>
				{/each}
			</tr>
		</thead>
		<tbody>
			{#each new Array(data[0].length) as d, i}
				<tr>
					{#each data as col}
						<td>{col[i] ?? 'N/A'}</td>
					{/each}
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<style>
	.preview-table-wrapper {
		overflow-x: auto;
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
