<!--
	The "Series" section head at the top of a plot's Data tab, shared by every plot: the
	section title, then the shared add row (BlockAdd: a one-line empty state and a labelled
	"+ Add series" button).

	It sits in normal flow. It replaces a bare + button that was pinned to the viewport with
	position: fixed, which assumed a one-line panel header: with a two-line plot title it
	covered a tab label, and on a faceted panel it covered the header's save/trash icons.
-->
<script>
	import BlockAdd from './BlockAdd.svelte';

	/**
	 * @type {{
	 *   label?: string,
	 *   onadd: () => unknown,
	 *   tooltip?: string,
	 *   ariaLabel?: string,
	 *   addLabel?: string,
	 *   count?: number | null,
	 *   empty?: string
	 * }}
	 */
	let {
		label = 'Series',
		onadd,
		tooltip = 'Add a series',
		ariaLabel = 'Add a series',
		// The button text after "+": "Add series" from "Add a series".
		addLabel = null,
		// The number of blocks below; the empty state shows only when it is 0.
		count = null,
		empty = null
	} = $props();

	const buttonLabel = $derived(addLabel ?? ariaLabel.replace(/^Add an? /, 'Add '));
	const emptyText = $derived(empty ?? `No ${label.toLowerCase()} yet`);
</script>

<div class="control-data-title control-data-add">
	<p>{label}</p>
</div>
<BlockAdd
	actions={[{ label: buttonLabel, onadd, tooltip, ariaLabel }]}
	count={count ?? -1}
	empty={emptyText}
/>
