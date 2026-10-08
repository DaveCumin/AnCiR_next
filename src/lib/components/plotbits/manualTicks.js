// Manual axis ticks: the text box's parser, and the domain filter applied at draw time.
// Used by Axis.svelte; kept here so the rules are testable without a component.

/**
 * Read a tick list typed by the user: numbers separated by commas, semicolons or spaces
 * (for example "0, 6, 12, 18, 24" or "0 6 12 18 24"). Entries that are not finite numbers are
 * returned in `invalid` so the panel can say what it ignored. The values come back sorted with
 * repeats removed, since an axis draws them in order anyway.
 * @param {string | null | undefined} text
 * @returns {{ values: number[], invalid: string[] }}
 */
export function parseTickList(text) {
	const values = new Set();
	const invalid = [];
	for (const token of String(text ?? '').split(/[\s,;]+/)) {
		if (token === '') continue;
		const n = Number(token);
		if (Number.isFinite(n)) values.add(n);
		else invalid.push(token);
	}
	return { values: [...values].sort((a, b) => a - b), invalid };
}

/**
 * The text box form of a stored tick list.
 * @param {number[] | null | undefined} ticks
 */
export function formatTickList(ticks) {
	return Array.isArray(ticks) ? ticks.join(', ') : '';
}

/**
 * Keep only the ticks inside the scale's domain, so a typed value beyond the axis limits is not
 * drawn outside the plot. A band or point scale (categories) and a non-numeric domain (dates)
 * are returned unchanged. The ends are inclusive with a small tolerance for rounding.
 * @param {any[]} ticks
 * @param {any} scale - a d3 scale
 */
export function ticksInDomain(ticks, scale) {
	if (typeof scale?.bandwidth === 'function') return ticks;
	const domain = scale?.domain?.() ?? [];
	if (domain.length < 2 || !domain.every((d) => typeof d === 'number' && Number.isFinite(d))) {
		return ticks;
	}
	const lo = Math.min(...domain);
	const hi = Math.max(...domain);
	const eps = (hi - lo) * 1e-9;
	return ticks.filter((t) => t >= lo - eps && t <= hi + eps);
}

/**
 * The manual ticks an axis should draw, or null for its automatic ones. Manual ticks are a
 * NUMERIC axis feature: on a categorical or time axis (by `tickMode`, or by a band or date
 * scale) a stored list is ignored rather than cleared, so an x column that becomes
 * categorical and later numeric again gets the user's ticks back. The categorical panel has
 * no tick control, so a list that still drew there could not be removed.
 * @param {number[] | null | undefined} manualTicks - the axis's stored list
 * @param {any} scale - a d3 scale
 * @param {'numeric' | 'time' | 'categorical'} [tickMode]
 * @returns {number[] | null}
 */
export function manualTicksToDraw(manualTicks, scale, tickMode = 'numeric') {
	if (tickMode !== 'numeric' || !manualTicks?.length) return null;
	if (typeof scale?.bandwidth === 'function') return null;
	if (scale?.domain?.()[0] instanceof Date) return null;
	return ticksInDomain(manualTicks, scale);
}
