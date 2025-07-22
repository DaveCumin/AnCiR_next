<script>
	let { headers, data } = $props();
</script>

<div class="preview-table-wrapper">
	<table>
		<thead
			><tr>
				{#each headers as header}
					<th>{header}</th>
				{/each}
			</tr></thead
		><tbody>
			{#each new Array(data[0].length) as d, i}
				<tr>
					{#each data as col}
						<td>{col[i] ?? NaN}</td>
					{/each}
				</tr>
			{/each}
		</tbody>
	</table>
</div>
