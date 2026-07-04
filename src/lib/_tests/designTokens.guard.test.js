// Design-token guardrail.
//
// After the 2026-07 design-system consolidation, a set of colour literals were
// replaced by canonical tokens in app.css (competing accent blues, two "success"
// greens, and the greys whose values exactly match a --color-lightness-* stop).
// This test fails if any of those literals reappear in a component, so the drift
// the consolidation fixed can't silently return. It is intentionally a DENYLIST
// (only the literals that have a canonical token) rather than a blanket "no hex"
// rule, so genuinely bespoke tints (status backgrounds, overlay rgba, etc.) stay
// allowed. When you add a new token, add its old literal here.
//
// If this test fails: replace the flagged hex with the mapped var(--…) token.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', '..'); // src/

// hex literal -> the token that should be used instead. Case-insensitive.
const BANNED = {
	// competing accent blues -> --color-accent (#4d9fe3)
	'#3b82f6': '--color-accent',
	'#0275ff': '--color-accent',
	// competing success greens -> --color-success
	'#10b981': '--color-success',
	'#28a745': '--color-success',
	// greys whose value is exactly a defined --color-lightness-* stop
	'#cccccc': '--color-lightness-80',
	'#666666': '--color-text-muted',
	'#333333': '--color-lightness-25',
	'#999999': '--color-lightness-60',
	'#aaaaaa': '--color-lightness-65',
	'#444444': '--color-lightness-30',
	'#808080': '--color-lightness-50',
	'#d9d9d9': '--color-lightness-85',
	'#b3b3b3': '--color-lightness-75',
	'#e6e6e6': '--color-lightness-90',
	'#f2f2f2': '--color-lightness-95',
	'#f5f5f5': '--color-lightness-96',
	'#f7f7f7': '--color-lightness-97',
	'#fafafa': '--color-lightness-98'
};

// Short (3-digit) forms of the greys, which resolve to the same colour.
const BANNED_SHORT = {
	'#ccc': '--color-lightness-80',
	'#666': '--color-text-muted',
	'#333': '--color-lightness-25',
	'#999': '--color-lightness-60',
	'#aaa': '--color-lightness-65'
};

function collect(dir, out = []) {
	for (const entry of readdirSync(dir)) {
		if (entry === 'node_modules' || entry.startsWith('.')) continue;
		const full = join(dir, entry);
		const st = statSync(full);
		if (st.isDirectory()) collect(full, out);
		else if (/\.(svelte|css)$/.test(entry) && !full.endsWith(join('src', 'app.css'))) out.push(full);
	}
	return out;
}

describe('design-token guardrail', () => {
	const files = collect(SRC);

	it('has files to scan', () => {
		expect(files.length).toBeGreaterThan(0);
	});

	// Regression guard for the 2026-07 incident where a global find/replace rewrote
	// app.css's own token definitions into self-references (e.g.
	// `--color-lightness-25: var(--color-lightness-25);`). A self-referential
	// custom property resolves to nothing, so every consumer silently fell back to
	// the CSS initial value (icons went black). Catch it in CI instead of the eye.
	it('app.css has no self-referential token definitions', () => {
		const appCss = readFileSync(join(SRC, 'app.css'), 'utf8');
		const selfRefs = [];
		appCss.split('\n').forEach((line, i) => {
			const m = line.match(/^\s*(--[a-z0-9-]+)\s*:\s*var\(\s*(--[a-z0-9-]+)\s*[),]/i);
			if (m && m[1] === m[2]) selfRefs.push(`app.css:${i + 1}  ${m[1]}: var(${m[1]})`);
		});
		expect(selfRefs, `Token defined as itself (resolves to nothing):\n${selfRefs.join('\n')}`).toEqual(
			[]
		);
	});

	it('uses no tokenized colour literals (denylist)', () => {
		const violations = [];
		for (const file of files) {
			const text = readFileSync(file, 'utf8');
			// skip embedded SVG data URIs — their hex is image content, not theme.
			const lines = text.split('\n');
			lines.forEach((line, i) => {
				if (line.includes('url(') || line.includes('svg+xml')) return;
				const lower = line.toLowerCase();
				for (const hex of Object.keys(BANNED)) {
					if (lower.includes(hex)) {
						violations.push(`${relative(SRC, file)}:${i + 1}  ${hex} → var(${BANNED[hex]})`);
					}
				}
				// 3-digit greys: match only when not part of a 6-digit hex.
				for (const [hex, token] of Object.entries(BANNED_SHORT)) {
					const re = new RegExp(hex + '(?![0-9a-fA-F])', 'gi');
					if (re.test(line)) {
						violations.push(`${relative(SRC, file)}:${i + 1}  ${hex} → var(${token})`);
					}
				}
			});
		}
		expect(violations, `Use the mapped token instead of the raw literal:\n${violations.join('\n')}`).toEqual(
			[]
		);
	});
});
