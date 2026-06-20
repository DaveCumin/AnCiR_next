<script>
	// @ts-nocheck
	import Icon from '$lib/icons/Icon.svelte';

	/**
	 * Common chrome for per-column processes: a titled box with a remove
	 * button. Processes render their own fields inside via the `children`
	 * snippet. Optionally overrides the heading text (defaults to p.displayName
	 * or p.name).
	 *
	 * Usage:
	 *   <ProcessShell {p}>
	 *     <NumberWithUnits bind:value={p.args.value} />
	 *   </ProcessShell>
	 */
	let { p, title = undefined, children = undefined } = $props();

	const heading = $derived(title ?? p.displayName ?? p.name);
</script>

<div class="control-input process">
	<div class="process-title">
		<p>{heading}</p>
		<!-- Legacy inline processes had an in-panel delete. Free operation nodes
		     (parentCol == null) are deleted via the node's own action button, so the
		     in-panel trash only shows for any remaining parent-owned process. -->
		{#if p.parentCol}
			<button
				class="icon"
				onclick={(e) => {
					e.stopPropagation();
					p.parentCol.removeProcess(p.id);
				}}
			>
				<Icon name="trash" width={16} height={16} className="control-component-title-icon" />
			</button>
		{/if}
	</div>
	{@render children?.()}
</div>
