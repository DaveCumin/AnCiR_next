// tourRunner.svelte.js
//
// Lazy, data-driven engine for the guided hands-on walkthroughs. The engine
// itself is tiny; each tour's CONTENT lives in its own file under
// `src/lib/tours/*.js` (discovered via import.meta.glob, so each tour is an
// on-demand chunk and the core bundle stays small). New tour = new file.
//
// A tour definition exports `{ id, name, description, estMinutes, order, steps }`.
// A step is data-driven:
//   {
//     target: string | (() => Element|null) | null,   // null = centered, no target
//     title, body,                                     // body may contain HTML
//     placement?: 'auto'|'top'|'bottom'|'left'|'right',
//     beforeShow?: () => void,        // e.g. switch view so the target exists
//     advance:
//        | { on: 'next' }             // passive — user clicks Next
//        | { when: () => boolean }    // hands-on — auto-advances when true
//        | { event: 'click', target?: string }  // advance on a DOM event
//   }

// Each value is a function returning a Promise of the module — loaded on demand.
// Exclude *.test.js: the glob otherwise pulls test files (which import node:fs /
// node:path) into the browser build and breaks `vite build`.
const tourModules = import.meta.glob(['$lib/tours/*.js', '!$lib/tours/*.test.js']);

// Reactive engine state shared across components (picker + overlay).
export const tourState = $state({
	pickerOpen: false,
	activeTour: null, // the resolved definition object
	index: -1
});

const DONE_KEY = 'ancir.tours.completed';

export function completedSet() {
	try {
		return new Set(JSON.parse(localStorage.getItem(DONE_KEY) || '[]'));
	} catch {
		return new Set();
	}
}

function markCompleted(id) {
	if (!id) return;
	try {
		const s = completedSet();
		s.add(id);
		localStorage.setItem(DONE_KEY, JSON.stringify([...s]));
	} catch {
		/* private mode / quota — ignore */
	}
}

/** Load every tour definition (lazily). Returns metadata for the picker. */
export async function loadTourList() {
	const out = [];
	for (const path in tourModules) {
		try {
			const mod = await tourModules[path]();
			if (mod?.tour?.steps?.length) out.push(mod.tour);
		} catch (err) {
			console.warn('[tour] failed to load', path, err);
		}
	}
	return out.sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
}

export function openPicker() {
	tourState.pickerOpen = true;
}
export function closePicker() {
	tourState.pickerOpen = false;
}

export function startTour(def) {
	if (!def?.steps?.length) return;
	tourState.pickerOpen = false;
	tourState.activeTour = def;
	tourState.index = 0;
}

export function nextStep() {
	const t = tourState.activeTour;
	if (!t) return;
	if (tourState.index < t.steps.length - 1) {
		tourState.index += 1;
	} else {
		finishTour();
	}
}

export function prevStep() {
	if (tourState.index > 0) tourState.index -= 1;
}

/** Stop without marking complete (user skipped / pressed Escape). */
export function stopTour() {
	tourState.activeTour = null;
	tourState.index = -1;
}

/** Reached the end — record completion, then stop. */
export function finishTour() {
	if (tourState.activeTour) markCompleted(tourState.activeTour.id);
	stopTour();
}
