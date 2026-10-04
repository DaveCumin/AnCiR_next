<script>
	// A small, in-place error report: what failed, the message, and a way to try again.
	// Shown where the failed content would have been (a node body, a plot card, a facet
	// panel) so a failure reads as "this part broke" rather than as a blank, and the rest of
	// the session stays usable. Used by ErrorBoundary (render errors) and by the analysis
	// nodes for a compute that threw (core/asyncCompute.js).
	let {
		title = 'Something went wrong here.',
		message = '',
		hint = '',
		onretry = null,
		retryLabel = 'Try again'
	} = $props();
</script>

<div class="error-box" role="alert">
	<strong class="error-box-title">{title}</strong>
	{#if message}
		<p class="error-box-message">{message}</p>
	{/if}
	{#if hint}
		<p class="error-box-hint">{hint}</p>
	{/if}
	{#if onretry}
		<button type="button" class="error-box-retry" onclick={() => onretry()}>{retryLabel}</button>
	{/if}
</div>

<style>
	.error-box {
		box-sizing: border-box;
		max-width: 100%;
		margin: var(--space-2) 0;
		padding: var(--space-2) var(--space-3, 6px);
		font-size: var(--font-xs);
		line-height: 1.4;
		color: var(--color-error);
		background: var(--color-error-bg);
		border: 1px solid var(--color-error-border);
		border-radius: var(--radius-sm);
		overflow: auto;
	}
	.error-box-title {
		display: block;
	}
	.error-box p {
		margin: var(--space-1, 2px) 0 0;
		overflow-wrap: anywhere;
	}
	.error-box-hint {
		color: var(--color-text-muted);
	}
	.error-box-retry {
		margin-top: var(--space-2);
		font: inherit;
		font-size: var(--font-xs);
		padding: var(--space-1, 2px) var(--space-2);
		border: 1px solid var(--color-lightness-85);
		border-radius: var(--radius-sm);
		background: var(--color-lightness-99);
		color: var(--color-text, inherit);
		cursor: pointer;
	}
</style>
