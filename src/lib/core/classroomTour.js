// classroomTour.js — shared helper for the classroom lesson tours.
// Each lesson tour loads a pre-built session (data + analysis graph + a teacher
// note) and then walks the student through reading it. Kept in core/ (not tours/)
// so the tours glob doesn't treat it as a tour. The loader reuses the exact same
// importJson the Load-session modal uses, so a lesson loads identically whether a
// student opens it from the tour or the examples gallery.
import { base } from '$app/paths';
import { appState } from '$lib/core/core.svelte.js';
import { importJson } from '$lib/components/iconActions/Setting.svelte';
import { addNotification } from '$lib/core/notifications.svelte.js';
import { fetchAppAsset, AppAssetUnavailableError } from '$lib/start/offline.js';
import { confirmReplaceSession } from '$lib/core/sessionLoad.svelte.js';
import { stopTour, tourState } from '$lib/core/tourRunner.svelte.js';

// Load a classroom lesson by file name (e.g. 'learn-hidden-rhythm.json') and show
// it on the canvas. Safe to call from a step's beforeShow; failures are swallowed
// with a console warning so the tour can still narrate.
//
// The lesson REPLACES the open session, so it asks first when there is work open (the
// same confirm as every other "open a session" entry point; it passes straight through
// on an empty app). On Cancel nothing is loaded and the lesson tour ends, since its
// steps narrate a session that is not there.
// Resolves true when the lesson was loaded (or attempted), false when the user cancelled.
export async function loadLesson(file) {
	// Named as the student sees it ("Sine waves are everywhere"), not by its file name.
	const title = tourState?.activeTour?.name?.replace(/^Lesson:\s*/, '');
	if (!(await confirmReplaceSession(title ? `the lesson "${title}"` : 'this lesson'))) {
		stopTour();
		return false;
	}
	try {
		const res = await fetchAppAsset(`${base}/sessions/classroom/${file}`);
		await importJson(await res.json());
	} catch (err) {
		// Offline download (file://) or no connection: say why the canvas is empty.
		if (err instanceof AppAssetUnavailableError) {
			addNotification(`This lesson's session could not be loaded.\n\n${err.message}`);
		}
		console.warn('[classroom-tour] failed to load lesson', file, err);
	}
	appState.view = 'canvas';
	return true;
}
