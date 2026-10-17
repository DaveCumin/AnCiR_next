// Import binning does what the panel shows when Confirm Import is pressed.
//
// The panel's defaults (on or off, and the interval) derive from the sampling interval of
// the PREVIEW rows. Over 15,000 rows the panel appears; on Confirm Import the full file
// replaces the preview, the interval read as unknown, and the import binned at the 15 min
// fallback while the panel said 5 (found 2026-10-16 importing 18,000 one-minute rows). An
// unticked panel (data sampled every 15 min or slower) could likewise be binned anyway.
import { describe, it, expect, beforeEach } from 'vitest';
import {
	openImportModalWithFiles,
	_importPreviewState,
	_importTestActions
} from './ImportData.svelte';
import { core } from '$lib/core/core.svelte';
import { getColumnById } from '$lib/core/Column.svelte';

/** n rows every `stepMin` minutes, with blanks in a run and singly. */
function csv(n, stepMin) {
	const lines = ['time,activity'];
	let t = Date.UTC(2026, 2, 1);
	for (let i = 0; i < n; i++) {
		const blank = i % 97 === 5 || (i >= 300 && i < 340);
		const v = blank ? '' : (100 + 50 * Math.sin((2 * Math.PI * t) / 86_400_000)).toFixed(3);
		lines.push(`${new Date(t).toISOString().slice(0, 19).replace('T', ' ')},${v}`);
		t += stepMin * 60_000;
	}
	return new File([lines.join('\n')], 'big.csv', { type: 'text/plain' });
}

function imported(name) {
	const c = core.data.map((x) => getColumnById(x.id)).find((x) => x.name === name);
	return Array.from(c.getData());
}

const steps = (times) => [...new Set(times.slice(1).map((t, i) => t - times[i]))];

beforeEach(() => {
	core.data = [];
});

describe('import binning uses the settings shown', () => {
	it('bins at the suggested interval, not the 15 min fallback', async () => {
		await openImportModalWithFiles([csv(18_000, 1)]);
		const shown = _importPreviewState();
		expect(shown.totalRowCount).toBeGreaterThan(15_000);
		expect(shown.binningEnabled).toBe(true);
		expect(shown.binIntervalMin).not.toBe(15);
		await _importTestActions().confirmImport();
		expect(steps(imported('time'))).toEqual([shown.binIntervalMin * 60_000]);
		expect(imported('activity').length).toBeCloseTo(18_000 / shown.binIntervalMin, -1);
		// About 1.3 s alone; a full parallel suite on a busy machine took it past the 5 s default.
	}, 30_000);

	it('does not bin when the panel is unticked', async () => {
		await openImportModalWithFiles([csv(16_000, 30)]);
		expect(_importPreviewState().binningEnabled).toBe(false);
		await _importTestActions().confirmImport();
		expect(imported('time')).toHaveLength(16_000);
	}, 30_000);
});
