// Tour copy shown in a card that can be squeezed to about 160px beside the import dialog
// (TourOverlay's MIN_CARD_W). At that width the browser breaks a hyphenated word at its hyphen
// ("Free-" over "running") even when the line could break at a space instead. Wrapping each
// hyphenated word in a `white-space: nowrap` span keeps it whole; the line breaks at a space.

// A word of letters or digits joined by hyphens: `free-running`, `day-to-day`, `café-style`.
const HYPHENATED = /[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)+/gu;

/**
 * Wrap every hyphenated word in the TEXT of `html` (never inside a tag, so attributes such as
 * `class="x-y"` are untouched) in `<span class="tour-nobreak">`. Entities contain no hyphen,
 * so they pass through as they were.
 * @param {string | null | undefined} html developer-authored tour copy (src/lib/tours/*.js)
 * @returns {string}
 */
export function keepHyphenatedWordsWhole(html) {
	return String(html ?? '')
		.split(/(<[^>]*>)/)
		.map((part) =>
			part.startsWith('<')
				? part
				: part.replace(HYPHENATED, (w) => `<span class="tour-nobreak">${w}</span>`)
		)
		.join('');
}
