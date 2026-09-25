<script>
	let { headers = [], rows = [] } = $props();
</script>

<table class="param-table">
	<thead>
		<tr>
			<!-- eslint-disable-next-line svelte/require-each-key -- fixed header row, rebuilt wholesale; position is the identity -->
			{#each headers as h}
				<!-- eslint-disable-next-line svelte/no-at-html-tags -- header cells are markup literals written in the handbook sources -->
				<th>{@html h}</th>
			{/each}
		</tr>
	</thead>
	<tbody>
		<!-- eslint-disable-next-line svelte/require-each-key -- static table rebuilt wholesale; row position is the identity -->
		{#each rows as row}
			<tr>
				<!-- eslint-disable-next-line svelte/require-each-key -- cells within a row are positional -->
				{#each row as cell}
					<!-- eslint-disable-next-line svelte/no-at-html-tags -- cells are markup literals written in the handbook sources -->
					<td>{@html cell}</td>
				{/each}
			</tr>
		{/each}
	</tbody>
</table>
