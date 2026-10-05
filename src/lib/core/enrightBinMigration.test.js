// @ts-nocheck
// The pure rule of the legacy Enright bin-size migration (enrightBinMigration.js). The same
// rule is ported to tools/ancir_runtime.py migrate_legacy_enright_bins and pinned across the
// two by the `sessionMigration` parity fixtures; the real load path is tested in
// tableProcesses/binSizeAuto.svelte.test.js.
import { describe, it, expect } from 'vitest';
import {
	migrateLegacyEnrightBins,
	isLegacyBinSession,
	isLegacyEnrightSeries,
	versionMajor
} from './enrightBinMigration.js';

const session = (version, ...series) => ({
	version,
	plots: [{ id: 0, type: 'periodogram', plot: { data: series } }]
});
const seriesOf = (json) => json.plots[0].plot.data;

describe('versionMajor / isLegacyBinSession', () => {
	it('reads the first number of every version shape the app has written', () => {
		expect(versionMajor('β.80.0')).toBe(80);
		expect(versionMajor('β.72.29')).toBe(72);
		expect(versionMajor('v81.0')).toBe(81);
		expect(versionMajor('81')).toBe(81);
		expect(versionMajor(undefined)).toBe(null);
		expect(versionMajor('unknown')).toBe(null);
	});
	it('below 81, or unreadable, is legacy; 81 and above is not', () => {
		expect(isLegacyBinSession('β.80.0')).toBe(true);
		expect(isLegacyBinSession('β.80.9')).toBe(true);
		expect(isLegacyBinSession(undefined)).toBe(true);
		expect(isLegacyBinSession('β.81.0')).toBe(false);
		expect(isLegacyBinSession('v81.0')).toBe(false);
		expect(isLegacyBinSession('β.100.0')).toBe(false);
	});
});

describe('isLegacyEnrightSeries', () => {
	it('Enright at the hidden 0.25 h, or with no bin size, and no binSizeAuto field', () => {
		expect(isLegacyEnrightSeries({ method: 'Enright', binSize: 0.25 })).toBe(true);
		expect(isLegacyEnrightSeries({ method: 'Enright' })).toBe(true);
	});
	it('anything else is not', () => {
		expect(isLegacyEnrightSeries({ method: 'Enright', binSize: 0.5 })).toBe(false);
		expect(isLegacyEnrightSeries({ method: 'Chi-squared', binSize: 0.25 })).toBe(false);
		expect(isLegacyEnrightSeries({ method: 'Lomb-Scargle', binSize: 0.25 })).toBe(false);
		expect(isLegacyEnrightSeries({ binSize: 0.25 })).toBe(false);
		expect(isLegacyEnrightSeries({ method: 'Enright', binSize: 0.25, binSizeAuto: false })).toBe(
			false
		);
	});
});

describe('migrateLegacyEnrightBins', () => {
	it('sets a legacy Enright series to follow its x and leaves its siblings alone', () => {
		const input = session(
			'β.72.29',
			{ method: 'Enright', binSize: 0.25 },
			{ method: 'Enright' },
			{ method: 'Enright', binSize: 0.5 },
			{ method: 'Chi-squared', binSize: 0.25 },
			{ method: 'Lomb-Scargle', binSize: 0.25 }
		);
		const before = JSON.stringify(input);
		const { json, migrated } = migrateLegacyEnrightBins(input);
		expect(migrated).toBe(2);
		expect(seriesOf(json)).toEqual([
			{ method: 'Enright', binSize: 0.25, binSizeAuto: true },
			{ method: 'Enright', binSize: 0.25, binSizeAuto: true },
			{ method: 'Enright', binSize: 0.5 },
			{ method: 'Chi-squared', binSize: 0.25 },
			{ method: 'Lomb-Scargle', binSize: 0.25 }
		]);
		// The input is not mutated.
		expect(JSON.stringify(input)).toBe(before);
	});

	it('a session at version 81 or later is returned as it is', () => {
		for (const v of ['β.81.0', 'v81.0', 'β.82.3']) {
			const input = session(v, { method: 'Enright', binSize: 0.25 });
			const { json, migrated } = migrateLegacyEnrightBins(input);
			expect(migrated).toBe(0);
			expect(json).toBe(input);
		}
	});

	it('only periodogram plots: an actogram series with the same fields is untouched', () => {
		const input = {
			version: 'β.79.0',
			plots: [{ id: 0, type: 'actogram', plot: { data: [{ method: 'Enright', binSize: 0.25 }] } }]
		};
		const { json, migrated } = migrateLegacyEnrightBins(input);
		expect(migrated).toBe(0);
		expect(json).toBe(input);
	});

	it('survives a session with no plots or a malformed plot', () => {
		expect(migrateLegacyEnrightBins({ version: 'β.70.0' }).migrated).toBe(0);
		expect(
			migrateLegacyEnrightBins({ version: 'β.70.0', plots: [null, { type: 'periodogram' }] })
				.migrated
		).toBe(0);
	});
});
