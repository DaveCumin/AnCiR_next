import { describe, it, expect } from 'vitest';
import { keepHyphenatedWordsWhole } from './tourText.js';

const span = (w) => `<span class="tour-nobreak">${w}</span>`;

describe('keepHyphenatedWordsWhole', () => {
	it('wraps each hyphenated word of the text, leaving the rest as it was', () => {
		expect(keepHyphenatedWordsWhole('a free-running, rest-activity rhythm')).toBe(
			`a ${span('free-running')}, ${span('rest-activity')} rhythm`
		);
	});

	it('works inside markup and never touches tags, attributes or entities', () => {
		const html =
			'Choose <strong>“Free-running period”</strong> under <em class="x-y">Rhythm &amp; circadian</em>';
		expect(keepHyphenatedWordsWhole(html)).toBe(
			`Choose <strong>“${span('Free-running')} period”</strong> under <em class="x-y">Rhythm &amp; circadian</em>`
		);
	});

	it('keeps words with several hyphens, and letters with accents, as one piece', () => {
		expect(keepHyphenatedWordsWhole('a day-to-day café-style note')).toBe(
			`a ${span('day-to-day')} ${span('café-style')} note`
		);
	});

	it('leaves a dash between spaces, a leading or trailing hyphen, and empty input alone', () => {
		expect(keepHyphenatedWordsWhole('one - two -three four-')).toBe('one - two -three four-');
		expect(keepHyphenatedWordsWhole('')).toBe('');
		expect(keepHyphenatedWordsWhole(null)).toBe('');
	});
});
