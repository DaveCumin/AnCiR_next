// Darken a hex colour by a fraction. Pure, no DOM.
//
// Used by the boxplot's raw-points overlay: the points are filled with the SAME
// colour as the box they sit on (fill follows the stroke by design, see
// BoxClass), so with a semi-transparent fill they can vanish against the box.
// A thin stroke in a darker shade of the same hue keeps each point legible
// without introducing a second colour into the figure.
//
// There was no existing darken helper in the codebase (the app darkens only via
// CSS color-mix(), which is unavailable inside SVG attribute values), hence this
// small one.

/**
 * Darken a CSS hex colour (#rgb or #rrggbb) by scaling each channel towards 0.
 * Anything unparseable (named colours, rgb() strings, null) is returned
 * unchanged — the caller always gets a usable stroke value.
 *
 * @param {string} colour - e.g. "#1f77b4" or "#abc"
 * @param {number} [amount=0.35] - fraction to darken by, clamped to [0, 1].
 *   0 = unchanged, 1 = black.
 * @returns {string}
 */
export function darkenColour(colour, amount = 0.35) {
	if (typeof colour !== 'string') return colour;
	const m = colour.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
	if (!m) return colour;

	let hex = m[1];
	if (hex.length === 3) {
		hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
	}

	const f = 1 - Math.min(1, Math.max(0, amount));
	const channel = (i) =>
		Math.round(parseInt(hex.slice(i, i + 2), 16) * f)
			.toString(16)
			.padStart(2, '0');

	return `#${channel(0)}${channel(2)}${channel(4)}`;
}
