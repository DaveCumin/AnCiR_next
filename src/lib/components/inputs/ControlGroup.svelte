<script>
	// @ts-nocheck
	/**
	 * A caption over a row of related ControlInputs, e.g.
	 *
	 *   Period range (hrs)
	 *   Min      Max      Step
	 *   [ 20 ]   [ 28 ]   [ 0.01 ]
	 *
	 * Three fields side by side leave ~60px each in a canvas node's editor panel,
	 * so a full label per field ("Period min (hrs)") wraps onto two lines. The
	 * shared part of the name goes in the caption and each field keeps a short
	 * label that fits on one line. The row is a role="group" named by the
	 * caption, so a screen reader announces "Period range (hrs), group" before
	 * "Min", and the short labels stay unambiguous.
	 *
	 * Props:
	 *  - label: the caption.
	 *  - children: the ControlInputs.
	 */
	let { label = '', children } = $props();
</script>

<div class="control-input control-group" role="group" aria-label={label}>
	<span class="ci-label" aria-hidden="true">{label}</span>
	<div class="control-input-horizontal control-group-row">
		{@render children?.()}
	</div>
</div>

<style>
	/* The enclosing .control-input-horizontal already spaces the group from the
	   next row. */
	.control-group-row {
		margin-bottom: 0;
	}
</style>
