import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
	resolveControlTab,
	rememberControlTab,
	rememberedControlTab,
	forgetControlTabs,
	stepControlTab
} from './controlTabs.js';

const ACTOGRAM = ['Properties', 'Data', 'Overlays'];
const PERIODOGRAM = ['Properties', 'Data'];
const SCATTER = ['Properties', 'Data', 'Overlays'];
const TABLEPLOT = ['Properties and Data'];

describe('UI-3: control tab on a selection change', () => {
	beforeEach(() => forgetControlTabs());

	it('Actogram Overlays then a periodogram shows a real periodogram tab', () => {
		// The reviewer's path: the panel went blank with no tab highlighted.
		expect(resolveControlTab('overlays', PERIODOGRAM, undefined)).toBe('properties');
	});

	it('Scatterplot Overlays then a periodogram, and anything then a Tableplot', () => {
		expect(resolveControlTab('overlays', PERIODOGRAM, undefined)).toBe('properties');
		expect(resolveControlTab('properties', TABLEPLOT, undefined)).toBe('properties and data');
		expect(resolveControlTab('data', TABLEPLOT, undefined)).toBe('properties and data');
	});

	it('a session saved on the old Annotations tab opens the Actogram on Overlays (UI-12)', () => {
		expect(resolveControlTab('annotations', ACTOGRAM, undefined)).toBe('overlays');
		expect(resolveControlTab('annotations', PERIODOGRAM, undefined)).toBe('properties');
	});

	it('keeps the tab when the new plot has it', () => {
		expect(resolveControlTab('data', PERIODOGRAM, 'properties')).toBe('data');
		expect(resolveControlTab('data', ACTOGRAM, undefined)).toBe('data');
	});

	it('falls back to the tab last used on that plot type', () => {
		rememberControlTab('actogram', 'overlays');
		rememberControlTab('scatterplot', 'overlays');
		expect(
			resolveControlTab('properties and data', ACTOGRAM, rememberedControlTab('actogram'))
		).toBe('overlays');
		expect(resolveControlTab('overlays', SCATTER, rememberedControlTab('scatterplot'))).toBe(
			'overlays'
		);
	});

	it('arrow keys wrap around the tabs', () => {
		expect(stepControlTab(ACTOGRAM, 'overlays', 1)).toBe('properties');
		expect(stepControlTab(ACTOGRAM, 'properties', -1)).toBe('overlays');
		expect(stepControlTab(ACTOGRAM, 'properties', 1)).toBe('data');
	});
});

describe('UI-23: control-panel tabs are exposed as tabs', () => {
	const src = fs.readFileSync(
		path.resolve('src/lib/components/views/ControlDisplay.svelte'),
		'utf8'
	);

	it('uses tablist / tab / aria-selected, and a tabpanel', () => {
		expect(src).toMatch(/class="control-tab" role="tablist"/);
		expect(src).toMatch(/role="tab"\s/);
		expect(src).toMatch(/aria-selected=\{active\}/);
		expect(src).toMatch(/role="tabpanel"/);
	});

	it('resolves the tab whenever the selection changes', () => {
		expect(src).toMatch(
			/resolveControlTab\(current, headers, rememberedControlTab\(plot\.type\)\)/
		);
	});
});
