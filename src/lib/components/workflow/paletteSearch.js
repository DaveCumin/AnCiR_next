// @ts-nocheck

/**
 * Palette search matching, extracted from NodePalette.svelte so it is testable
 * in isolation. Matching is a case-insensitive substring test over a haystack
 * of family, display name, registry key (type), description, and the entry's
 * hidden `keywords` (from nodeMeta.js). Keywords are search-only: they are
 * never rendered anywhere in the UI.
 */

/**
 * Build the lowercase haystack string a query is matched against.
 * @param {{family?: string, displayName?: string, type?: string, description?: string, keywords?: string[]}} item
 */
export function paletteHaystack(item) {
	const kw = Array.isArray(item.keywords) ? item.keywords.join(' ') : '';
	return `${item.family ?? ''} ${item.displayName ?? ''} ${item.type ?? ''} ${item.description ?? ''} ${kw}`.toLowerCase();
}

/**
 * Filter palette items by a free-text query (case-insensitive substring).
 * An empty/whitespace query returns the input array unchanged.
 * @param {Array} items
 * @param {string} query
 */
export function filterPaletteItems(items, query) {
	const q = (query ?? '').trim().toLowerCase();
	if (!q) return items;
	return items.filter((it) => paletteHaystack(it).includes(q));
}
