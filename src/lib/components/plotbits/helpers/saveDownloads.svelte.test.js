// The CSV and SVG plot exports must not revoke their object URL straight after the click:
// Firefox and Safari read the blob asynchronously, so an immediate revoke can cancel the
// download (ROB-U2). They share downloadBlob, which frees the URL a minute later.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { core } from '$lib/core/core.svelte';
import { saveDataAsCSV, saveStaticDataAsCSV, saveExport } from './save.svelte.js';
import { REVOKE_OBJECT_URL_AFTER_MS } from '$lib/utils/downloadBlob.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const realCreate = URL.createObjectURL;
const realRevoke = URL.revokeObjectURL;
let revoked;
let clicked;
let hosts;

beforeEach(() => {
	revoked = [];
	clicked = [];
	hosts = [];
	URL.createObjectURL = () => 'blob:test-url';
	URL.revokeObjectURL = (url) => revoked.push(url);
	vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
		clicked.push(this.download);
	});
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	URL.createObjectURL = realCreate;
	URL.revokeObjectURL = realRevoke;
	for (const h of hosts) h.remove();
	core.plots.length = 0;
});

/** Revoked only after the delay, never at the click. */
function expectDelayedRevoke() {
	expect(revoked).toEqual([]);
	vi.advanceTimersByTime(REVOKE_OBJECT_URL_AFTER_MS);
	expect(revoked).toEqual(['blob:test-url']);
}

describe('plot downloads keep their object URL alive past the click', () => {
	it('saveStaticDataAsCSV', () => {
		saveStaticDataAsCSV('Trend: stats', ['a'], [[1]]);
		expect(clicked).toEqual(['Trend_ stats.csv']);
		expectDelayedRevoke();
	});

	it('saveDataAsCSV', () => {
		core.plots.push({
			id: 7,
			name: 'Wheel',
			plot: { getDownloadData: () => ({ headers: ['t'], rows: [[0], [1]] }) }
		});
		saveDataAsCSV(7);
		expect(clicked).toEqual(['Wheel.csv']);
		expectDelayedRevoke();
	});

	it('saveExport as svg', async () => {
		const host = document.createElement('div');
		host.innerHTML = `<svg xmlns="${SVG_NS}" id="plot3" width="200" height="100" viewBox="0 0 200 100"><circle r="5" /></svg>`;
		document.body.appendChild(host);
		hosts.push(host);
		core.plots.push({ id: 3, name: 'Svg', x: 0, y: 0, width: 200, height: 100, style: null });
		const n = await saveExport([3], { format: 'svg', combined: false });
		expect(n).toBe(1);
		expect(clicked).toEqual(['Svg.svg']);
		expectDelayedRevoke();
	});
});
