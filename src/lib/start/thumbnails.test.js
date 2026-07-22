import { describe, it, expect } from 'vitest';
import { thumbnailForWorkflow, thumbnailFromSeries } from './thumbnails.js';

const WORKFLOW_IDS = [
	'workflow-rest-activity',
	'workflow-free-running',
	'workflow-phase-groups',
	'workflow-stats-eda',
	'workflow-stats-two-group',
	'workflow-stats-anova',
	'workflow-stats-correlation',
	'workflow-stats-regression',
	'workflow-stats-logistic',
	'workflow-stats-chi-square',
	'workflow-non24-blind',
	'workflow-arrhythmic',
	'workflow-circatidal',
	'workflow-reentrainment',
	'workflow-split-rhythm',
	'workflow-noise-peak',
	'workflow-aliasing',
	'workflow-crepuscular',
	'workflow-masking'
];

describe('thumbnailForWorkflow', () => {
	it('returns an SVG for every shipped workflow', () => {
		for (const id of WORKFLOW_IDS) {
			const s = thumbnailForWorkflow(id);
			expect(s.startsWith('<svg'), id).toBe(true);
			expect(s.endsWith('</svg>'), id).toBe(true);
		}
	});

	it('is deterministic — the same id always yields byte-identical markup', () => {
		for (const id of WORKFLOW_IDS) {
			expect(thumbnailForWorkflow(id)).toBe(thumbnailForWorkflow(id));
		}
	});

	it('gives every workflow an explicit shape, not the silent fallback', () => {
		// Distinctness alone does not catch a missing WORKFLOW_SHAPE entry: the fallback is
		// seeded by id, so a map with no entries at all still yields distinct pictures. The
		// fallback draws a single <path>; every real shape draws rects, circles or lines.
		const fallbackOnly = WORKFLOW_IDS.filter((id) => {
			const svg = thumbnailForWorkflow(id);
			return svg.includes('<path') && !/<rect|<circle|<line/.test(svg);
		});
		expect(fallbackOnly).toEqual(['workflow-aliasing']); // the only card that IS a sparkline
	});

	it('gives different workflows different pictures', () => {
		const seen = new Set(WORKFLOW_IDS.map((id) => thumbnailForWorkflow(id)));
		expect(seen.size).toBe(WORKFLOW_IDS.length);
	});

	it('stays small enough to sit in the localStorage recents index', () => {
		// 8 entries cap; keep each comfortably inside a "few kB" budget.
		for (const id of WORKFLOW_IDS) {
			expect(thumbnailForWorkflow(id).length, id).toBeLessThan(4000);
		}
	});

	it('is monochrome — draws only in currentColor', () => {
		for (const id of WORKFLOW_IDS) {
			const s = thumbnailForWorkflow(id);
			expect(/#[0-9a-f]{3,6}|rgb\(|hsl\(/i.test(s), id).toBe(false);
		}
	});

	it('falls back to a stable image for an unknown id', () => {
		const a = thumbnailForWorkflow('not-a-workflow');
		expect(a.startsWith('<svg')).toBe(true);
		expect(a).toBe(thumbnailForWorkflow('not-a-workflow'));
	});

	it('double-plots the rhythm actograms (a midline splits the 48 h row)', () => {
		for (const id of ['workflow-rest-activity', 'workflow-free-running', 'workflow-phase-groups']) {
			expect(thumbnailForWorkflow(id), id).toContain('<line x1="60"');
		}
	});
});

describe('thumbnailFromSeries', () => {
	const daily = Array.from({ length: 24 * 7 }, (_, i) => (i % 24 >= 8 && i % 24 < 18 ? 80 : 5));

	it('draws a multi-day record as a double-plotted actogram', () => {
		const s = thumbnailFromSeries(daily, { samplesPerDay: 24 });
		expect(s.startsWith('<svg')).toBe(true);
		expect(s).toContain('<line x1="60"'); // the double-plot midline
	});

	it('draws a short record as a sparkline (no actogram midline)', () => {
		const s = thumbnailFromSeries([1, 4, 2, 8, 3], { samplesPerDay: 24 });
		expect(s).toContain('<path');
	});

	it('falls back for empty / unusable data', () => {
		expect(thumbnailFromSeries([], { seed: 'x' }).startsWith('<svg')).toBe(true);
		expect(thumbnailFromSeries(null, { seed: 'x' }).startsWith('<svg')).toBe(true);
	});

	it('reflects the data — different series give different pictures', () => {
		const other = daily.map((v, i) => (i % 24 >= 2 && i % 24 < 12 ? 80 : 5));
		expect(thumbnailFromSeries(daily, { samplesPerDay: 24 })).not.toBe(
			thumbnailFromSeries(other, { samplesPerDay: 24 })
		);
	});
});
