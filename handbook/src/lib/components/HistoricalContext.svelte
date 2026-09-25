<script>
	let { entries = [] } = $props();
</script>

<div class="box box-history">
	<div class="box-title">📜 Historical Context</div>
	{#each entries as entry (entry.year)}
		<div class="timeline-entry">
			<!-- eslint-disable-next-line svelte/no-at-html-tags -- entry.text is author-written handbook prose from the chapter sources, not user input -->
			<span class="timeline-year">{entry.year}</span> — {@html entry.text}
		</div>
	{/each}
</div>

<style>
	.box-history {
		background: #fffbeb;
		border-color: #d97706;
	}
	.box-history .box-title {
		color: #92400e;
	}
	.timeline-entry {
		margin-bottom: 7px;
		font-size: 0.9rem;
		line-height: 1.5;
	}
	.timeline-year {
		font-weight: 600;
		color: #92400e;
	}
</style>
