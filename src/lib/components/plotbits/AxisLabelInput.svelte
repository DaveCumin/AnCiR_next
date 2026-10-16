<script>
	// @ts-nocheck
	// The text box for an axis's label (the shared Axis controls, and the categorical x axes of
	// the Boxplot and the Mean ± SEM plot, which have no other axis settings).
	//
	// What is typed shows on the plot as it is typed (a plain write, a preview). On Enter or
	// blur the label from before the edit is put back and the new one committed through
	// commitAxisEdit (plots/axisEdits.js): ONE undo step and an unsaved change, which undoes to
	// exactly what was stored before (an empty Periodogram label, shown as the method's default,
	// comes back empty, so the default shows again). Escape puts the label back and commits
	// nothing.
	import { commitAxisEdit } from '$lib/plots/axisEdits.js';

	let { axisData, placeholder = undefined, ariaLabel = undefined } = $props();

	let startLabel = null; // the stored label when the box took focus; null when not editing

	function begin() {
		startLabel = axisData.label ?? '';
	}

	function commit(e) {
		const next = e.currentTarget.value;
		if (startLabel != null) axisData.label = startLabel;
		startLabel = null;
		commitAxisEdit(axisData, 'label', next);
	}

	function keydown(e) {
		if (e.key === 'Enter') {
			e.currentTarget.blur(); // commits through change
			return;
		}
		if (e.key !== 'Escape' || startLabel == null) return;
		e.preventDefault();
		e.stopPropagation(); // the edit only, not whatever Escape does for the page
		axisData.label = startLabel;
		e.currentTarget.value = startLabel;
		startLabel = null;
		e.currentTarget.blur();
	}
</script>

<input
	value={axisData.label}
	{placeholder}
	aria-label={ariaLabel}
	onfocus={begin}
	oninput={(e) => (axisData.label = e.currentTarget.value)}
	onchange={commit}
	onkeydown={keydown}
/>
