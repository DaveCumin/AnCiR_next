// classroomTour.js — shared helper for the classroom lesson tours.
// Each lesson tour loads a pre-built session (data + analysis graph + a teacher
// note) and then walks the student through reading it. Kept in core/ (not tours/)
// so the tours glob doesn't treat it as a tour. The loader reuses the exact same
// importJson the Load-session modal uses, so a lesson loads identically whether a
// student opens it from the tour or the examples gallery.
import { base } from '$app/paths';
import { appState } from '$lib/core/core.svelte.js';
import { importJson } from '$lib/components/iconActions/Setting.svelte';

// Load a classroom lesson by file name (e.g. 'learn-hidden-rhythm.json') and show
// it on the canvas. Safe to call from a step's beforeShow; failures are swallowed
// with a console warning so the tour can still narrate.
export async function loadLesson(file) {
	try {
		const res = await fetch(`${base}/sessions/classroom/${file}`);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		await importJson(await res.json());
	} catch (err) {
		// eslint-disable-next-line no-console
		console.warn('[classroom-tour] failed to load lesson', file, err);
	}
	appState.view = 'canvas';
}
