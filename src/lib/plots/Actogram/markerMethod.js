// The one-line method note shown wherever the automatic onset/offset markers are set up
// (MarkerRuleBlock.svelte and PhaseMarker.svelte). It describes matchTemplateMarkers in
// onsetUnwrap.js: each row (with the next) is scored above or below the % percentile, and the
// marker goes where a template of N hours below then M hours above matches best (reversed for
// an offset). No published reference for the method is recorded in the code or the handbook,
// so the note names the method without citing one.
export const TEMPLATE_METHOD_NOTE =
	'Method: template matching. Activity is scored above or below the % percentile, and the marker goes where N h below then M h above fits best (the reverse for offsets).';
