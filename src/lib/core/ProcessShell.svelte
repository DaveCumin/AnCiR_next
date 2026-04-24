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
		<button
			class="icon"
			onclick={(e) => {
				e.stopPropagation();
				p.parentCol.removeProcess(p.id);
			}}
		>
			<Icon name="minus" width={16} height={16} className="control-component-title-icon" />
		</button>
	</div>
	{@render children?.()}
</div>
