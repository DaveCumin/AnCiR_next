// The DOM id of a marker rule's block in the actogram's Data tab, shared by the block
// (MarkerRuleBlock.svelte) and a rule instance's "Edit rule" link (PhaseMarker.svelte).
// Rule ids are unique per plot only, so the plot's id is part of it.
export function ruleBlockDomId(inner, ruleId) {
	return `marker-rule-${inner?.parentBox?.id ?? 'x'}-${ruleId}`;
}
