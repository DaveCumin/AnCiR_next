// render_plot reports what the plot warns about in its own controls (render/payloadColumn.js
// plotWarnings), so a box plot that made one group per value of a numeric x is not a silent
// picture.
import { describe, expect, it } from 'vitest';
import { plotWarnings } from '../src/render/payloadColumn.js';

class Base {
	get violinWarnings() {
		return ['few points', 'few points'];
	}
}
class Inner extends Base {
	get categoryWarnings() {
		return ['numeric x'];
	}
	get notAList() {
		return 'x';
	}
	get brokenWarnings() {
		throw new Error('boom');
	}
}

describe('plotWarnings', () => {
	it('collects every ...Warnings list on the class chain, once each, skipping a throw', () => {
		expect(plotWarnings(new Inner()).sort()).toEqual(['few points', 'numeric x']);
	});
	it('is empty for a plot with no warnings or no plot', () => {
		expect(plotWarnings({})).toEqual([]);
		expect(plotWarnings(null)).toEqual([]);
	});
});
