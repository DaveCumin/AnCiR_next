// @ts-nocheck
// The handful of things the start screen can do. Kept out of the component so the screen stays
// presentational and each action has one obvious home.
import { base } from '$app/paths';
import { appState, core } from '$lib/core/core.svelte.js';
import { importJson } from '$lib/components/iconActions/Setting.svelte';
import { addNotification } from '$lib/core/notifications.svelte.js';
import { recordRecent } from '$lib/start/recentSessions.svelte.js';
import { thumbnailForWorkflow } from '$lib/start/thumbnails.js';

/**
 * Manifest names carry a "Workflow — " prefix and are lower case. One normalisation, shared by the
 * example cards and the recent rows, so a session is called the same thing in both places.
 */
export function displayName(name) {
	const t = (name ?? '').replace(/^Workflow\s*—\s*/, '');
	return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Resolve a manifest-relative example url against the deployed base path. */
export function resolveExampleUrl(url) {
	if (!url) return url;
	return /^https?:\/\//i.test(url) ? url : `${base}/${url.replace(/^\//, '')}`;
}

/**
 * Open a bundled example with its demo data — read-only exploration, no commitment.
 * Mirrors the load-session modal's example path (fetch the session JSON, then importJson).
 */
export async function openExample(session, onProgress) {
	const url = resolveExampleUrl(session.url);
	const res = await fetch(url);
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const data = await res.json();
	await importJson(data, onProgress);
	// Examples earn a recent row too: the url makes them reopenable in one click anywhere, which
	// is the whole point of the section. Keyed by example id so re-opening refreshes in place.
	await recordRecent({
		id: `example::${session.id}`,
		name: displayName(session.name),
		meta: sessionMeta(),
		workflow: session.id,
		thumb: thumbnailForWorkflow(session.id),
		url: session.url
	});
}

/** A one-line "what's in here" for a recent row, read off the session we just loaded. */
export function sessionMeta() {
	const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
	return [plural(core.data?.length ?? 0, 'column'), plural(core.plots?.length ?? 0, 'plot')].join(
		' · '
	);
}

/**
 * Open a session FILE (the user's own saved .json) and record it as a recent.
 *
 * This is the single chokepoint for "open a session from disk" on the start screen, so recording
 * can never drift out of sync with loading. `handle` is a FileSystemFileHandle when the browser
 * gave us one; storing it is what lets the next visit reopen in one click with no picker.
 */
export async function openSessionFile(file, handle = null, onProgress) {
	const data = JSON.parse(await file.text());
	await importJson(data, onProgress);
	const name = file.name.replace(/\.json$/i, '');
	await recordRecent({
		id: `file::${file.name}`,
		name,
		meta: sessionMeta(),
		thumb: thumbnailForWorkflow(name), // unknown id → deterministic procedural fallback
		handle
	});
}

/**
 * Ask for a session file, preferring the File System Access API so we come away with a re-openable
 * handle. Returns {status:'ok', file, handle} | {status:'cancelled'} | {status:'unsupported'}
 * ('unsupported' means the caller should fall back to the existing <input type="file"> modal).
 */
export async function pickSessionFile() {
	if (typeof window === 'undefined' || typeof window.showOpenFilePicker !== 'function') {
		return { status: 'unsupported' };
	}
	try {
		const [handle] = await window.showOpenFilePicker({
			multiple: false,
			types: [{ description: 'AnCiR session', accept: { 'application/json': ['.json'] } }]
		});
		return { status: 'ok', file: await handle.getFile(), handle };
	} catch (e) {
		if (e?.name === 'AbortError') return { status: 'cancelled' };
		return { status: 'unsupported' }; // e.g. blocked by policy: degrade to the modal
	}
}


/** Spawn a Simulate Data node on the canvas (same route the empty-state prompt uses). */
export function simulateData() {
	appState.view = 'canvas';
	appState.spawnNodeRequest = { tpType: 'SimulatedData', n: (appState.spawnNodeRequest?.n ?? 0) + 1 };
	appState.showControlPanel = true;
}

/** Fetch the example manifest, split into the groups the start screen shows. */
export async function loadExampleManifest() {
	const res = await fetch(`${base}/sessions/demos/index.json`);
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const idx = await res.json();
	const workflows = (idx.sessions ?? []).filter((s) => s.kind === 'workflow');
	const groups = new Map();
	for (const s of workflows) {
		const g = s.group ?? 'Examples';
		if (!groups.has(g)) groups.set(g, []);
		groups.get(g).push(s);
	}
	// Rhythm, then general statistics, then the cards about interpreting either.
	const order = ['Rhythm & circadian', 'General statistics', 'Reading the output'];
	return [...groups.entries()].sort((a, b) => {
		const ai = order.indexOf(a[0]);
		const bi = order.indexOf(b[0]);
		return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
	});
}

export function notifyFailure(what, err) {
	addNotification(`${what}\n\n${err?.message ?? err}`);
}
