import { describe, it, expect } from 'vitest';
import { defaultAxisLabel } from './axisLabels.js';

// A plain `{ name }` stands in for a column (displayNameOf reads its name).
const col = (name) => ({ name });

describe('defaultAxisLabel', () => {
	it("is the column's name when every series shows that one column", () => {
		expect(defaultAxisLabel([col('time_h')])).toBe('time_h');
		expect(defaultAxisLabel([col('time_h'), col('time_h')])).toBe('time_h');
	});
	it('is empty for different columns on one axis (the legend names them) or none', () => {
		expect(defaultAxisLabel([col('temp'), col('temp2')])).toBe('');
		expect(defaultAxisLabel([])).toBe('');
		expect(defaultAxisLabel([null, col('')])).toBe('');
	});
	it('skips an unwired slot', () => {
		expect(defaultAxisLabel([null, col('temp')])).toBe('temp');
	});
});
