// @ts-nocheck
// Copying nodes BETWEEN tabs.
//
// Within one tab the canvas already keeps snapshots in a component-local array. Those snapshots
// are the interesting part: snapshotNode() strips ids, clears every input/output and drops
// processes, so what it produces is already plain, position-independent JSON. Carrying it to
// another tab is therefore a transport problem, not a format problem.
//
// WHY THE SYSTEM CLIPBOARD
//
//   • localStorage + the `storage` event would work, and writes node configuration back to disk
//     — which is exactly what ephemeral mode exists to stop (see core/localData.svelte.js).
//   • BroadcastChannel only reaches tabs that are ALREADY OPEN, so "copy, open a new tab,
//     paste" — the main thing anyone wants — fails.
//   • The system clipboard survives tab close and browser restart, needs no permission when
//     read from a real `paste` event, and lets a user paste a node into an email to share a
//     configuration.
//
// CONFIG NODES ONLY
//
// Data columns are deliberately excluded. `Column.toJSON()` emits `data` as a KEY into
// core.rawData rather than the values, so a column pasted into another tab would arrive empty;
// carrying it properly would mean putting the actual series on the system clipboard, which is
// the opposite of the direction the storage work just took. Processes, analyses, plots, notes
// and groups are pure settings and carry no data at all, so they travel freely.

/** Marks a clipboard payload as ours. Anything else on the clipboard is left to the browser. */
export const ENVELOPE_KIND = 'ancir/nodes';

/**
 * Bumped when the entry shape changes incompatibly. A stale envelope is REFUSED with a message
 * rather than pasted partially — half a node graph is worse than none, and silently dropping
 * fields the older build didn't have is how "it pasted but the settings are wrong" happens.
 */
export const CLIPBOARD_VERSION = 1;

/**
 * Node types that carry configuration only, and so can cross a tab boundary.
 *
 * `group` is conditional, not absolute: an EMPTY group is pure configuration, but one that has
 * absorbed columns carries their data and is treated like a data column. See isConfigEntry.
 */
export const CONFIG_TYPES = new Set(['process', 'tableprocess', 'plot', 'note', 'group']);

/** Can this entry leave the tab? Fails closed: an unrecognised type is assumed to carry data. */
export function isConfigEntry(entry) {
	if (!CONFIG_TYPES.has(entry?.type)) return false;
	if (entry.type === 'group' && (entry.columns?.length ?? 0) > 0) return false;
	return true;
}

/** Split a selection into what may cross tabs and what may not. */
export function partitionEntries(entries) {
	const config = [];
	const local = [];
	for (const e of entries ?? []) (isConfigEntry(e) ? config : local).push(e);
	return { config, local };
}

/** Serialise config entries for the system clipboard. Returns null when there is nothing to carry. */
export function encodeEnvelope(entries) {
	const { config } = partitionEntries(entries);
	if (!config.length) return null;
	try {
		return JSON.stringify({ kind: ENVELOPE_KIND, version: CLIPBOARD_VERSION, entries: config });
	} catch {
		return null;
	}
}

/**
 * Read clipboard text back.
 *
 * @returns {{ok: true, entries: object[]} | {ok: false, reason: string} | null}
 *   null means "not ours" — the caller should fall through to its own clipboard rather than
 *   treating it as an error, because most pastes are ordinary text.
 */
export function parseEnvelope(text) {
	if (typeof text !== 'string' || !text.includes(ENVELOPE_KIND)) return null;
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch {
		return null;
	}
	if (parsed?.kind !== ENVELOPE_KIND) return null;
	if (parsed.version !== CLIPBOARD_VERSION) {
		return {
			ok: false,
			reason: `That was copied from a different version of AnCiR (clipboard v${parsed.version ?? '?'}, this build reads v${CLIPBOARD_VERSION}).`
		};
	}
	const entries = Array.isArray(parsed.entries) ? parsed.entries.filter(isConfigEntry) : [];
	if (!entries.length)
		return { ok: false, reason: 'That AnCiR clipboard payload had no nodes in it.' };
	return { ok: true, entries };
}

/**
 * Best-effort write to the system clipboard. Never throws and never blocks the copy: a browser
 * that refuses (no permission, insecure context, older Safari) still gets same-tab paste from
 * the canvas's own array, so refusing must degrade rather than fail.
 * @returns {Promise<boolean>} whether the write actually happened
 */
export async function writeToSystemClipboard(text) {
	if (!text || typeof navigator === 'undefined') return false;
	try {
		await navigator.clipboard?.writeText(text);
		return true;
	} catch {
		return false;
	}
}
