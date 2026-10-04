// @ts-nocheck
// Getting a session back after a crash (ROB-5).
//
// errorReporter.js keeps a copy of the open session in sessionStorage whenever something
// throws, and its toast tells the user so. Until this module nothing ever READ that copy: the
// natural reaction to a broken canvas is to reload, and the reload simply started empty. The
// copy sat in the tab, unreachable, until the tab closed.
//
// Now, on every start of the app, a kept copy is offered back:
//
//   "AnCiR hit an error at 14:32 and kept a copy of the session open then. [Restore session] ✕"
//
//   Restore  loads it through the app's one safe loader (importJson: validated, all or
//            nothing, rolls back on failure), after the usual confirm if something else is
//            already open. The copy is deleted once it has been restored, and the restored
//            session counts as unsaved, so closing the tab asks first.
//   ✕        discards the copy (it is a whole session, imported data included, and the user
//            has said they do not want it).
//   ignored  the toast stays until acted on (no timeout), and the copy stays in the tab, so a
//            further reload offers it again.
//
// sessionStorage, so the copy and this offer are scoped to the tab that crashed, which is the
// privacy decision recorded in errorReporter.js. That also means the offer only appears in a
// reload of THAT tab, which is exactly the case it is for.
import { readCrashSnapshot, clearCrashSnapshot } from './errorReporter.js';
import { addNotification } from './notifications.svelte.js';
import { markSessionUnsaved } from './unsavedChanges.svelte.js';

/** "14:32" (today) or "3 Oct, 14:32", in the user's locale; '' if unreadable. */
export function formatSavedAt(iso, now = new Date()) {
	const d = new Date(iso);
	if (!iso || Number.isNaN(d.getTime())) return '';
	const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
	const sameDay = d.toDateString() === now.toDateString();
	if (sameDay) return time;
	return `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, ${time}`;
}

/** What the kept session holds, for the offer: "4 columns, 2 analyses, 1 plot". */
export function describeSession(session) {
	const parts = [];
	const count = (n, one, many) => {
		if (n > 0) parts.push(`${n} ${n === 1 ? one : many}`);
	};
	count(session?.data?.length ?? 0, 'column', 'columns');
	count(session?.tableProcesses?.length ?? 0, 'analysis', 'analyses');
	count(session?.plots?.length ?? 0, 'plot', 'plots');
	return parts.join(', ');
}

/**
 * Offer the crash copy back, if this tab holds one with something in it.
 *
 * @param {object} deps
 * @param {(session: object) => Promise<any>} deps.restore  load a session (importJson)
 * @param {(what: string) => Promise<boolean>} [deps.confirmReplace]  ask before replacing open
 *   work (confirmReplaceSession); resolves true when nothing is open
 * @returns {string|null} the notification id, or null when there was nothing to offer
 */
export function offerCrashRecovery({ restore, confirmReplace = async () => true }) {
	const snap = readCrashSnapshot();
	const session = snap?.session;
	const what = describeSession(session);
	if (!session || typeof session !== 'object' || !what) {
		// Unreadable or empty: nothing worth offering, and nothing worth keeping.
		if (snap) clearCrashSnapshot();
		return null;
	}
	const when = formatSavedAt(snap.savedAt);
	const message =
		`AnCiR hit an error${when ? ` at ${when}` : ''} and kept a copy of the session that was ` +
		`open then (${what}) in this browser tab. Restore it, or close this message to discard ` +
		'the copy.';

	let busy = false;
	async function run() {
		if (busy) return;
		busy = true;
		try {
			if (!(await confirmReplace('the session from before the error'))) {
				// Kept: the user chose their current work for now. A reload offers it again.
				addNotification(
					'The copy from before the error is still kept in this tab; reload the page to ' +
						'be offered it again.',
					'info',
					8000
				);
				return;
			}
			await restore(session);
			clearCrashSnapshot();
			// Its only other copy is gone now, so closing the tab must ask (unsavedChanges).
			markSessionUnsaved();
			addNotification('Restored the session from before the error.', 'info', 6000);
		} catch (err) {
			addNotification(
				`Could not restore the session from before the error: ${err?.message ?? err}\n\n` +
					'Your open session was not changed, and the copy is still kept in this tab.',
				'error',
				0
			);
		} finally {
			busy = false;
		}
	}

	return addNotification(
		message,
		'warning',
		0,
		{ label: 'Restore session', run },
		{ onDismiss: () => clearCrashSnapshot() }
	);
}
