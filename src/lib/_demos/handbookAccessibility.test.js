// The handbook's own accessibility floor (review UI-24), checked from the root suite like
// handbookProseCoverage.test.js, because the handbook package has no test runner of its own.
//
//   1. Every animation slider has an accessible name. A bare <input type="range"> next to a
//      <span>Speed</span> is announced as "slider, 1" with nothing to say what it moves.
//   2. Link text meets WCAG AA (4.5:1) on every background the handbook puts prose on. Links
//      used the bright accent (#4d9fe3), 2.84:1 on white, which is a focus-ring colour, not a
//      text colour (the shared tokens say so).
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');
const hb = join(repo, 'handbook', 'src');

function walk(dir, out = []) {
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) walk(p, out);
		else if (p.endsWith('.svelte')) out.push(p);
	}
	return out;
}

/**
 * Every `<input ...>` tag in a Svelte source, whole. Scanned with brace depth rather than a regex,
 * because an attribute like `oninput={(e) => {...}}` contains a `>` that would end a naive match.
 */
function inputTags(src) {
	const tags = [];
	let from = 0;
	for (;;) {
		const start = src.indexOf('<input', from);
		if (start < 0) return tags;
		let depth = 0;
		let i = start;
		for (; i < src.length; i++) {
			const ch = src[i];
			if (ch === '{') depth++;
			else if (ch === '}') depth--;
			else if (ch === '>' && depth === 0) break;
		}
		tags.push(src.slice(start, i + 1));
		from = i + 1;
	}
}

describe('handbook sliders', () => {
	const sliders = [];
	for (const file of walk(hb)) {
		const src = readFileSync(file, 'utf8');
		for (const tag of inputTags(src)) {
			if (/type="range"/.test(tag)) sliders.push({ file: relative(repo, file), tag });
		}
	}

	it('finds the sliders (the scan still works)', () => {
		expect(sliders.length).toBeGreaterThanOrEqual(17);
	});

	it('every slider has a non-empty aria-label', () => {
		const unnamed = sliders
			.filter((s) => !/aria-label=("[^"]+"|\{[^}]+\})/.test(s.tag))
			.map((s) => s.file);
		expect(unnamed, `sliders with no accessible name: ${unnamed.join(', ')}`).toEqual([]);
	});
});

// WCAG 2.x relative luminance and contrast ratio.
function luminance(hex) {
	const h = hex.replace('#', '');
	const [r, g, b] = [0, 2, 4].map((i) => {
		const c = parseInt(h.slice(i, i + 2), 16) / 255;
		return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

describe('handbook link colour', () => {
	const appCss = readFileSync(join(hb, 'app.css'), 'utf8');
	const tokens = readFileSync(join(repo, 'packages', 'design', 'tokens.css'), 'utf8');
	const vars = {};
	for (const css of [tokens, appCss]) {
		for (const m of css.matchAll(/(--[\w-]+):\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
	}
	/** Follow var(--x) chains to a hex colour. */
	const resolve = (v) => {
		for (let i = 0; i < 10 && v?.startsWith('var('); i++) {
			v = vars[v.match(/var\((--[\w-]+)/)[1]];
		}
		return v;
	};
	const linkRule = appCss.match(/(?:^|\n)a \{([^}]*)\}/);
	const linkColour = resolve(linkRule?.[1].match(/color:\s*([^;]+);/)?.[1].trim());

	it('resolves the link colour to a hex value', () => {
		expect(linkColour).toMatch(/^#[0-9a-f]{6}$/i);
	});

	// White cards, the page canvas, info panels, the hover/active-nav tint, and highlighted <em>.
	it.each(['--surface', '--bg', '--panel-bg', '--blue-lt', '--gold-lt'])(
		'meets AA 4.5:1 on %s',
		(bgVar) => {
			const bg = resolve(`var(${bgVar})`);
			expect(contrast(linkColour, bg)).toBeGreaterThanOrEqual(4.5);
		}
	);
});
