<script>
	import Icon from '$lib/icons/Icon.svelte';
	let { message = 'Loading...', detail = '' } = $props();
</script>

<div class="title-container">
	<Icon name="spinner" width={32} height={32} className="spinner" />
	<div>
		<p>{message}</p>
		{#if detail}
			<p class="progress-detail">{detail}</p>
		{/if}
	</div>
</div>

<style>
	.title-container {
		display: flex;
		justify-content: left;
		align-items: center;
		gap: 10px;
	}

	.title-container p {
		margin: 0;
	}

	.progress-detail {
		font-size: 0.9em;
		color: var(--color-lightness-50);
		margin-top: 0.25rem !important;
	}
</style>
