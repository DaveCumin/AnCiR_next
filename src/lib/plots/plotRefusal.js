// The message a plot draws on itself when its analysis refused a series (an FFT over a long
// gap, for example). The full reason, with its advice, stays in the Data tab; the plot shows
// its first sentence, wrapped to the plot's width, so a node on the canvas says WHY it is
// empty instead of drawing bare axes.

/** The first sentence of a reason ("a. b." -> "a."), or the whole text when it has one. */
export function firstSentence(reason) {
	const text = String(reason ?? '').trim();
	// A full stop followed by a space ends a sentence; "0.5 h" (a stop before a digit) does not.
	const m = /^(.*?\.)\s/.exec(text);
	// Keep a number with the unit after it on one line when the message wraps.
	return (m ? m[1] : text).replace(/(\d) (h|%|samples?)\b/g, '$1\u00a0$2');
}

/** Words of `text` packed into lines of at most `maxChars` (a longer word gets its own line). */
export function wrapWords(text, maxChars) {
	const limit = Math.max(8, Math.floor(maxChars));
	const lines = [];
	let line = '';
	// Split on ordinary spaces only: a no-break space keeps a number with its unit ("50 h").
	for (const w of String(text ?? '')
		.split(/[ \t\n]+/)
		.filter(Boolean)) {
		if (line && line.length + 1 + w.length > limit) {
			lines.push(line);
			line = w;
		} else {
			line = line ? `${line} ${w}` : w;
		}
	}
	if (line) lines.push(line);
	return lines;
}

/**
 * Lines to draw for the refused series of a plot.
 *
 * @param {{label: string, reason: string}[]} refused series that produced no result, with why
 * @param {number} maxChars characters that fit across the plot area
 * @param {string} [what] what the plot could not make, e.g. 'No spectrum'
 * @param {number} [seriesCount] how many series the plot has; with one, the label is left out
 * @returns {string[]}
 */
export function refusalLines(refused, maxChars, what = 'No result', seriesCount = 1) {
	const lines = [];
	for (const { label, reason } of refused ?? []) {
		if (!reason) continue;
		const head = seriesCount > 1 && label ? `${label}: ${what.toLowerCase()}` : what;
		lines.push(...wrapWords(`${head}: ${firstSentence(reason)}`, maxChars));
	}
	return lines;
}
