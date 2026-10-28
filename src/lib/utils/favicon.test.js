// @vitest-environment happy-dom
// The tab icon follows the palette through undo and redo. Undoing a palette change used to
// keep the new palette's icon: only Settings set it, never the setAppColours operation that
// undo and redo replay.
import { describe, it, expect, beforeEach } from 'vitest';
import { appState } from '$lib/core/core.svelte.js';
import { applyOp } from '$lib/core/operations.js';
import { faviconHref, resetFaviconForTest } from './favicon.js';

const SHIPPED = 'data:image/svg+xml,shipped';
const A = ['#234154', '#BE796B', '#3E7295'];
const B = ['#361338', '#A6BED8', '#000000'];

const icon = () => document.querySelector('link[rel="icon"]').getAttribute('href');
const stops = (href) =>
	[...decodeURIComponent(href).matchAll(/stop-color='#([0-9A-Fa-f]{6})'/g)].map((m) => m[1]);

beforeEach(() => {
	resetFaviconForTest();
	document.head.innerHTML = `<link rel="icon" href="${SHIPPED}" />`;
	appState.appColours = [...A];
});

describe('favicon', () => {
	it('draws the gradient between the first two palette colours', () => {
		expect(stops(faviconHref(B))).toEqual(['361338', 'A6BED8']);
		// An eight-digit (alpha) colour gives six digits, not seven.
		expect(stops(faviconHref(['#fbe67280', '#A6BED8']))).toEqual(['fbe672', 'A6BED8']);
	});

	it('follows a palette change, its undo and its redo', () => {
		const inverse = applyOp({ kind: 'setAppColours', colours: B });
		expect(stops(icon())).toEqual(['361338', 'A6BED8']);
		// Undo replays the inverse. Back to the palette the page loaded with: the shipped icon.
		const redo = applyOp(inverse);
		expect(icon()).toBe(SHIPPED);
		applyOp(redo);
		expect(stops(icon())).toEqual(['361338', 'A6BED8']);
	});
});
