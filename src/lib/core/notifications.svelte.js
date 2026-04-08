// @ts-nocheck

export const errorDialog = $state({ show: false, message: '' });

/** Show an error modal with an OK button. */
export function showError(message) {
	errorDialog.message = message;
	errorDialog.show = true;
}
