<!--
	The labelled "add series" row at the top of a plot's Data tab, shared by every plot.

	It sits in normal flow, in the same section-title pattern as the Actogram's "Marker
	rules" row (label on the left, a + icon on the right). It replaces a bare + button
	that was pinned to the viewport with position: fixed, which assumed a one-line panel
	header: with a two-line plot title it covered the "Annotations" tab label, and on a
	faceted panel it covered the header's save/trash icons.
-->
<script>
	import Icon from '$lib/icons/Icon.svelte';
	import { tooltip as attachTooltip } from '$lib/utils/tooltip.js';

	/**
	 * @type {{
	 *   label?: string,
	 *   onadd: () => unknown,
	 *   tooltip?: string,
	 *   ariaLabel?: string
	 * }}
	 */
	let { label = 'Series', onadd, tooltip = 'Add a series', ariaLabel = 'Add a series' } = $props();
</script>

<div class="control-data-title with-icon control-data-add">
	<p>{label}</p>
	<div class="control-component-title-icons">
		<button
			class="icon"
			aria-label={ariaLabel}
			onclick={() => onadd?.()}
			{@attach attachTooltip(tooltip)}
		>
			<Icon name="add" width={16} height={16} className="control-component-title-icon" />
		</button>
	</div>
</div>
