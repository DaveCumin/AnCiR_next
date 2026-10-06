// @ts-nocheck
// Which of the two "nothing here yet" surfaces an empty session shows. Kept as one pure function
// so the rule that they never stack (the add-data prompt must not sit under the start-screen
// overlay) has one home and a test, rather than two conditions in +page.svelte that can drift.

/**
 * @param {object} s
 * @param {boolean} s.sessionIsEmpty   no data, plots or nodes
 * @param {boolean} s.startDismissed   the user closed the start screen on this empty session
 * @param {boolean} s.deepLinkPending  a ?session= load is in flight
 * @param {boolean} s.welcomeSummoned  the start screen was reopened from Help
 * @returns {{ showStartScreen: boolean, offerAddData: boolean }}
 */
export function startOverlayState({
	sessionIsEmpty,
	startDismissed,
	deepLinkPending,
	welcomeSummoned
}) {
	const showStartScreen = sessionIsEmpty && !startDismissed && !deepLinkPending;
	return {
		showStartScreen,
		// The start screen covers an empty session first. Once it is dismissed the canvas and the
		// workspace would otherwise be blank (UI-9), so they offer the add-data prompt instead.
		offerAddData: sessionIsEmpty && !showStartScreen && !deepLinkPending && !welcomeSummoned
	};
}
