// One column-type -> icon map for the type selector and every canvas node (UI-21). The
// numeric type used the 'math' icon, a percent-like glyph, so numeric columns read as
// percentages; it is now a '#', matching the '#' already shown on metric rows.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { COLUMN_TYPE_META, columnTypeIcon, columnTypeMeta } from './columnTypeIcon.js';
import { hasIcon } from '$lib/icons/iconRegistry.js';

const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('column type icons', () => {
	it('shows numeric columns with a # icon, not the percent-like math glyph', () => {
		expect(columnTypeIcon('number')).toBe('hash');
		expect(columnTypeIcon('number')).not.toBe('math');
	});

	it('maps every type to an icon that exists, and unknown types to the numeric one', () => {
		for (const { icon } of Object.values(COLUMN_TYPE_META)) expect(hasIcon(icon), icon).toBe(true);
		expect(columnTypeIcon('category')).toBe('list');
		expect(columnTypeIcon('time')).toBe('clock');
		expect(columnTypeIcon('bin')).toBe('table');
		expect(columnTypeIcon('weird')).toBe('hash');
		expect(columnTypeMeta({ type: 'weird' })).toEqual({ icon: 'hash', label: 'weird' });
		expect(columnTypeMeta(undefined)).toEqual({ icon: 'hash', label: 'value' });
		expect(columnTypeMeta({ type: 'number' })).toEqual({ icon: 'hash', label: 'Numeric' });
	});

	it('is the only column-type icon map: no component keeps its own', () => {
		for (const rel of [
			'lib/components/reusables/TypeSelector.svelte',
			'lib/components/workflow/TableProcessNode.svelte',
			'lib/components/workflow/GroupNode.svelte',
			'lib/components/workflow/nodeGeometry.js'
		]) {
			const text = readFileSync(resolve(srcRoot, rel), 'utf8');
			expect(text, rel).not.toMatch(/['"]math['"]/);
		}
	});
});
